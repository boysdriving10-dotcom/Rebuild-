import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { createGameInDatabase, fetchPublicGames } from '@/services/gamesApi';
import type { CreateGameInput, Game } from '@/types';

type ActionResult = { ok: true; game: Game } | { ok: false; error: string };

type GamesContextValue = {
  games: Game[];
  /** True while the initial Supabase games fetch is in progress. */
  isLoading: boolean;
  createGame: (
    input: CreateGameInput,
    host: { id: string; username: string }
  ) => Promise<ActionResult>;
  joinGame: (gameId: string, userId: string) => ActionResult;
  leaveGame: (gameId: string, userId: string) => ActionResult;
  removeUserData: (userId: string) => void;
  getGamesForCourt: (courtId: string) => Game[];
  isJoined: (gameId: string, userId: string) => boolean;
  countHosted: (userId: string) => number;
  countJoined: (userId: string) => number;
  refreshGames: () => Promise<void>;
};

const GamesContext = createContext<GamesContextValue | null>(null);

export function GamesProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshGames = useCallback(async () => {
    const result = await fetchPublicGames();
    if (result.ok) {
      setGames(result.data);
    } else if (__DEV__) {
      console.warn('[games] fetchPublicGames failed:', result.error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      const result = await fetchPublicGames();
      if (cancelled) return;
      if (result.ok) {
        setGames(result.data);
      } else if (__DEV__) {
        console.warn('[games] initial fetch failed:', result.error);
      }
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const createGame = useCallback(
    async (
      input: CreateGameInput,
      _host: { id: string; username: string }
    ): Promise<ActionResult> => {
      // host_id is taken from the authenticated Supabase session inside the API —
      // the client-supplied host id is ignored for the database write.
      const result = await createGameInDatabase(input);
      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      setGames((prev) => {
        const withoutDup = prev.filter((g) => g.id !== result.data.id);
        return [result.data, ...withoutDup];
      });

      return { ok: true, game: result.data };
    },
    []
  );

  // Join/leave stay local-only until game_players + secure RPCs are added.
  const joinGame = useCallback((gameId: string, userId: string): ActionResult => {
    const current = games.find((g) => g.id === gameId);
    if (!current) return { ok: false, error: 'Game not found.' };
    if (current.playerIds.includes(userId)) {
      return { ok: false, error: 'You already joined this game.' };
    }
    if (current.currentPlayers >= current.maxPlayers) {
      return { ok: false, error: 'This game is full.' };
    }

    const updated: Game = {
      ...current,
      playerIds: [...current.playerIds, userId],
      currentPlayers: current.currentPlayers + 1,
    };
    setGames((prev) => prev.map((g) => (g.id === gameId ? updated : g)));
    return { ok: true, game: updated };
  }, [games]);

  const leaveGame = useCallback((gameId: string, userId: string): ActionResult => {
    const current = games.find((g) => g.id === gameId);
    if (!current) return { ok: false, error: 'Game not found.' };
    if (!current.playerIds.includes(userId)) {
      return { ok: false, error: 'You are not in this game.' };
    }

    const updated: Game = {
      ...current,
      playerIds: current.playerIds.filter((id) => id !== userId),
      currentPlayers: Math.max(0, current.currentPlayers - 1),
    };
    setGames((prev) => prev.map((g) => (g.id === gameId ? updated : g)));
    return { ok: true, game: updated };
  }, [games]);

  const removeUserData = useCallback((userId: string) => {
    setGames((prev) =>
      prev
        .filter((g) => g.hostId !== userId)
        .map((g) => {
          if (!g.playerIds.includes(userId)) return g;
          const playerIds = g.playerIds.filter((id) => id !== userId);
          return {
            ...g,
            playerIds,
            currentPlayers: playerIds.length,
          };
        })
    );
  }, []);

  const getGamesForCourt = useCallback(
    (courtId: string) => games.filter((g) => g.courtId === courtId),
    [games]
  );

  const isJoined = useCallback(
    (gameId: string, userId: string) => {
      const game = games.find((g) => g.id === gameId);
      return Boolean(game?.playerIds.includes(userId));
    },
    [games]
  );

  const countHosted = useCallback(
    (userId: string) => games.filter((g) => g.hostId === userId).length,
    [games]
  );

  const countJoined = useCallback(
    (userId: string) =>
      games.filter((g) => g.playerIds.includes(userId) && g.hostId !== userId).length,
    [games]
  );

  const value = useMemo(
    () => ({
      games,
      isLoading,
      createGame,
      joinGame,
      leaveGame,
      removeUserData,
      getGamesForCourt,
      isJoined,
      countHosted,
      countJoined,
      refreshGames,
    }),
    [
      games,
      isLoading,
      createGame,
      joinGame,
      leaveGame,
      removeUserData,
      getGamesForCourt,
      isJoined,
      countHosted,
      countJoined,
      refreshGames,
    ]
  );

  return <GamesContext.Provider value={value}>{children}</GamesContext.Provider>;
}

export function useGames() {
  const ctx = useContext(GamesContext);
  if (!ctx) {
    throw new Error('useGames must be used within GamesProvider');
  }
  return ctx;
}
