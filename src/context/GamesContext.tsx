import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { CreateGameInput, Game } from '@/types';

type ActionResult = { ok: true; game: Game } | { ok: false; error: string };

type GamesContextValue = {
  games: Game[];
  createGame: (input: CreateGameInput, host: { id: string; username: string }) => ActionResult;
  joinGame: (gameId: string, userId: string) => ActionResult;
  leaveGame: (gameId: string, userId: string) => ActionResult;
  getGamesForCourt: (courtId: string) => Game[];
  isJoined: (gameId: string, userId: string) => boolean;
  countHosted: (userId: string) => number;
  countJoined: (userId: string) => number;
};

const GamesContext = createContext<GamesContextValue | null>(null);

function makeGameId() {
  return `game-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function GamesProvider({ children }: { children: ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);

  const createGame = useCallback(
    (input: CreateGameInput, host: { id: string; username: string }): ActionResult => {
      if (!input.courtId || !input.courtName) {
        return { ok: false, error: 'Pick a court for your game.' };
      }
      if (!host.id) {
        return { ok: false, error: 'You must be logged in to create a game.' };
      }

      const game: Game = {
        id: makeGameId(),
        courtId: input.courtId,
        courtName: input.courtName,
        courtLatitude: input.courtLatitude,
        courtLongitude: input.courtLongitude,
        courtAddress: input.courtAddress || 'Address unavailable',
        distance: 'Nearby',
        time: input.time,
        date: input.date,
        currentPlayers: 1,
        maxPlayers: input.maxPlayers,
        isPublic: input.isPublic,
        hostId: host.id,
        hostUsername: host.username,
        playerIds: [host.id],
      };

      setGames((prev) => [game, ...prev]);
      return { ok: true, game };
    },
    []
  );

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
      createGame,
      joinGame,
      leaveGame,
      getGamesForCourt,
      isJoined,
      countHosted,
      countJoined,
    }),
    [
      games,
      createGame,
      joinGame,
      leaveGame,
      getGamesForCourt,
      isJoined,
      countHosted,
      countJoined,
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
