import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { CreateGameInput, Game } from '@/types';

export type GamesApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type GameRow = {
  id: string;
  host_id: string;
  host_username: string;
  court_id: string;
  court_name: string;
  court_latitude: number;
  court_longitude: number;
  court_address: string;
  date: string;
  time: string;
  max_players: number;
  current_players: number;
  is_public: boolean;
  status: string;
  created_at?: string;
  updated_at?: string;
  game_players?: { user_id: string }[] | null;
};

type MembershipUpdate = {
  currentPlayers: number;
  status: string;
  playerIds: string[];
};

/** Map a public.games row to the app Game shape (distance is client-only). */
export function mapGameRowToGame(row: GameRow): Game {
  return {
    id: row.id,
    courtId: row.court_id,
    courtName: row.court_name,
    courtLatitude: Number(row.court_latitude),
    courtLongitude: Number(row.court_longitude),
    courtAddress: row.court_address || 'Address unavailable',
    distance: 'Nearby',
    time: row.time,
    date: row.date,
    currentPlayers: row.current_players,
    maxPlayers: row.max_players,
    isPublic: row.is_public,
    hostId: row.host_id,
    hostUsername: row.host_username,
    status: row.status,
    playerIds: playerIdsFromRow(row),
  };
}

function playerIdsFromRow(row: GameRow): string[] {
  const ids = (row.game_players ?? [])
    .map((player) => player.user_id)
    .filter((id) => typeof id === 'string' && id.length > 0);
  return ids.length > 0 ? ids : [row.host_id];
}

function parseMembershipUpdate(data: unknown): MembershipUpdate | null {
  if (!data || typeof data !== 'object') return null;
  const row = data as {
    current_players?: unknown;
    status?: unknown;
    player_ids?: unknown;
  };
  const currentPlayers = Number(row.current_players);
  if (!Number.isFinite(currentPlayers) || typeof row.status !== 'string' || !Array.isArray(row.player_ids)) {
    return null;
  }
  const playerIds = row.player_ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return { currentPlayers, status: row.status, playerIds };
}

function friendlyGamesError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('row-level security') || lower.includes('permission') || lower.includes('policy')) {
    return 'You do not have permission to do that. Try logging in again.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Network error. Check your connection and try again.';
  }
  if (lower.includes('jwt') || lower.includes('not authenticated') || lower.includes('auth')) {
    return 'You must be logged in to continue.';
  }
  return message || 'Something went wrong. Please try again.';
}

/**
 * Insert a game into public.games.
 * host_id always comes from the authenticated Supabase session — never from the client argument.
 */
export async function createGameInDatabase(
  input: CreateGameInput
): Promise<GamesApiResult<Game>> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Games are not configured. Add your Supabase URL and anon key to the .env file.',
    };
  }

  if (!input.courtId || !input.courtName) {
    return { ok: false, error: 'Pick a court for your game.' };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, error: 'You must be logged in to create a game.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle();

  const metaUsername =
    typeof user.user_metadata?.username === 'string' ? user.user_metadata.username.trim() : '';
  const hostUsername =
    profile?.username?.trim() || metaUsername || user.email?.split('@')[0] || 'player';

  const { data, error } = await supabase
    .from('games')
    .insert({
      host_id: user.id,
      host_username: hostUsername,
      court_id: input.courtId,
      court_name: input.courtName,
      court_latitude: input.courtLatitude,
      court_longitude: input.courtLongitude,
      court_address: input.courtAddress || 'Address unavailable',
      date: input.date,
      time: input.time,
      max_players: input.maxPlayers,
      current_players: 1,
      is_public: input.isPublic,
      status: 'open',
    })
    .select(
      'id, host_id, host_username, court_id, court_name, court_latitude, court_longitude, court_address, date, time, max_players, current_players, is_public, status, created_at, updated_at'
    )
    .single();

  if (error || !data) {
    return { ok: false, error: friendlyGamesError(error?.message ?? 'Could not create game.') };
  }

  return { ok: true, data: mapGameRowToGame(data as GameRow) };
}

/** Fetch public, non-cancelled games for the Home / map lists. */
export async function fetchPublicGames(): Promise<GamesApiResult<Game[]>> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Games are not configured. Add your Supabase URL and anon key to the .env file.',
    };
  }

  const { data, error } = await supabase
    .from('games')
    .select(
      'id, host_id, host_username, court_id, court_name, court_latitude, court_longitude, court_address, date, time, max_players, current_players, is_public, status, created_at, updated_at, game_players(user_id)'
    )
    .eq('is_public', true)
    .in('status', ['open', 'full'])
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return { ok: false, error: friendlyGamesError(error.message) };
  }

  const games = (data as GameRow[] | null)?.map(mapGameRowToGame) ?? [];
  return { ok: true, data: games };
}

/** Host-only. Keeps the row and marks it cancelled so it drops out of active feeds. */
export async function cancelGameInDatabase(gameId: string): Promise<GamesApiResult<null>> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Games are not configured. Add your Supabase URL and anon key to the .env file.',
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, error: 'You must be logged in to cancel a game.' };
  }

  // Do not .select() the updated row. A cancelled game is hidden by the
  // feed SELECT policy, so an empty read is not proof the update failed.
  const { error } = await supabase
    .from('games')
    .update({ status: 'cancelled' })
    .eq('id', gameId)
    .eq('host_id', user.id);

  if (error) {
    return { ok: false, error: friendlyGamesError(error.message) };
  }

  return { ok: true, data: null };
}

/** Persist a join. The database locks the game and updates the roster count. */
export async function joinGameInDatabase(gameId: string): Promise<GamesApiResult<MembershipUpdate>> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Games are not configured. Add your Supabase URL and anon key to the .env file.',
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, error: 'You must be logged in to join a game.' };
  }

  const { data, error } = await supabase.rpc('join_game', { p_game_id: gameId });
  if (error) {
    return { ok: false, error: friendlyGamesError(error.message) };
  }

  const parsed = parseMembershipUpdate(data);
  if (!parsed) {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }

  return { ok: true, data: parsed };
}

/** Persist a leave. The database frees the spot and updates the roster count. */
export async function leaveGameInDatabase(gameId: string): Promise<GamesApiResult<MembershipUpdate>> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Games are not configured. Add your Supabase URL and anon key to the .env file.',
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, error: 'You must be logged in to leave a game.' };
  }

  const { data, error } = await supabase.rpc('leave_game', { p_game_id: gameId });
  if (error) {
    return { ok: false, error: friendlyGamesError(error.message) };
  }

  const parsed = parseMembershipUpdate(data);
  if (!parsed) {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }

  return { ok: true, data: parsed };
}
