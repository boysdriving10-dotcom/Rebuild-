import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  cancelGameInDatabase,
  createGameInDatabase,
  fetchPublicGames,
  joinGameInDatabase,
  leaveGameInDatabase,
} from '@/services/gamesApi';
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
  joinGame: (gameId: string, userId: string) => Promise<ActionResult>;
  leaveGame: (gameId: string, userId: string) => Promise<ActionResult>;
  cancelGame: (gameId: string, userId: string) => Promise<ActionResult>;
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

  const cancelGame = useCallback(
    async (gameId: string, userId: string): Promise<ActionResult> => {
      const current = games.find((g) => g.id === gameId);
      if (!current) return { ok: false, error: 'Game not found.' };
      if (current.hostId !== userId) {
        return { ok: false, error: 'Only the host can cancel this game.' };
      }

      const result = await cancelGameInDatabase(gameId);
      if (!result.ok) return result;

      setGames((prev) => prev.filter((g) => g.id !== gameId));
      return { ok: true, game: current };
    },
    [games]
  );

  const joinGame = useCallback(async (gameId: string, _userId: string): Promise<ActionResult> => {
    const current = games.find((g) => g.id === gameId);
    if (!current) return { ok: false, error: 'Game not found.' };

    const result = await joinGameInDatabase(gameId);
    if (!result.ok) {
      if (result.error === 'This game is no longer available.') {
        setGames((prev) => prev.filter((g) => g.id !== gameId));
      }
      return result;
    }

    const updated: Game = {
      ...current,
      currentPlayers: result.data.currentPlayers,
      status: result.data.status,
      playerIds: result.data.playerIds,
    };
    setGames((prev) => prev.map((g) => (g.id === gameId ? updated : g)));
    return { ok: true, game: updated };
  }, [games]);

  const leaveGame = useCallback(async (gameId: string, _userId: string): Promise<ActionResult> => {
    const current = games.find((g) => g.id === gameId);
    if (!current) return { ok: false, error: 'Game not found.' };

    const result = await leaveGameInDatabase(gameId);
    if (!result.ok) {
      if (result.error === 'This game is no longer available.') {
        setGames((prev) => prev.filter((g) => g.id !== gameId));
      }
      return result;
    }

    const updated: Game = {
      ...current,
      currentPlayers: result.data.currentPlayers,
      status: result.data.status,
      playerIds: result.data.playerIds,
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
      cancelGame,
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
      cancelGame,
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
