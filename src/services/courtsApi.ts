import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Court } from '@/types';

export type CourtsApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type CourtVerificationStatus = 'unverified' | 'verified' | 'rejected';

/** Map bounds used by Overpass / useMapCourts (south, west, north, east). */
export type CourtBBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

/** Row shape for public.courts. */
export type CourtRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  source: string;
  source_id: string;
  verification_status: CourtVerificationStatus;
  created_at?: string;
  updated_at?: string;
};

const COURT_SELECT =
  'id, name, latitude, longitude, address, city, region, country, source, source_id, verification_status, created_at, updated_at';

export const COURTS_QUERY_LIMIT_MAX = 500;

/** True when south ≤ north, west ≤ east, and values are finite map coordinates. */
export function isValidCourtBBox(bbox: CourtBBox): boolean {
  const { south, west, north, east } = bbox;
  if (![south, west, north, east].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return false;
  }
  if (south > north || west > east) return false;
  if (south < -90 || north > 90) return false;
  if (west < -180 || east > 180) return false;
  return true;
}

/**
 * Clamp a requested page size to 1..COURTS_QUERY_LIMIT_MAX.
 * Non-finite, ≤0, or missing values fall back to the max.
 */
export function clampCourtsQueryLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return COURTS_QUERY_LIMIT_MAX;
  }
  return Math.min(Math.floor(limit), COURTS_QUERY_LIMIT_MAX);
}

/** Overpass source_id form stored in public.courts, e.g. node/123 or way/456. */
const OVERPASS_SOURCE_ID_RE = /^(node|way)\/(\d+)$/;

/**
 * App-facing Court.id from DB source fields.
 * Overpass rows become osm-node-123 / osm-way-456 so games stay compatible.
 * Returns null for blank, malformed, or unsupported ids (caller should skip).
 */
export function appCourtIdFromSource(source: string, sourceId: string): string | null {
  if (typeof source !== 'string' || typeof sourceId !== 'string') return null;
  const src = source.trim();
  const sid = sourceId.trim();
  if (!src || !sid) return null;

  if (src === 'overpass') {
    const match = OVERPASS_SOURCE_ID_RE.exec(sid);
    if (!match) return null;
    return `osm-${match[1]}-${match[2]}`;
  }

  // Non-overpass catalog rows (e.g. fallback) use source-source_id when both are safe tokens.
  if (/^[a-z0-9_-]+$/i.test(src) && /^[a-z0-9_-]+$/i.test(sid)) {
    return `${src}-${sid}`;
  }

  return null;
}

/**
 * Map a public.courts row to the app Court shape (activeGameIds filled by games layer).
 * Returns null when source/source_id cannot produce a game-compatible Court.id.
 */
export function mapCourtRowToCourt(row: CourtRow): Court | null {
  const id = appCourtIdFromSource(row.source, row.source_id);
  if (!id) return null;

  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    id,
    name: row.name,
    latitude,
    longitude,
    address: row.address?.trim() || 'Address unavailable',
    activeGameIds: [],
  };
}

function friendlyCourtsError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('row-level security') || lower.includes('permission') || lower.includes('policy')) {
    return 'You do not have permission to load courts.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Network error. Check your connection and try again.';
  }
  return message || 'Something went wrong. Please try again.';
}

export type FetchCourtsInBoundsOptions = {
  /**
   * When true (default), only rows with verification_status = verified.
   * Pass false only for trusted/admin tooling — public RLS still hides non-verified rows.
   */
  verifiedOnly?: boolean;
  /** Soft cap to protect the client; clamped to 1..500 (default 500). */
  limit?: number;
};

/**
 * Fetch courts whose coordinates fall inside the visible map bounds.
 * Not wired into useMapCourts yet — Overpass remains the live map source.
 */
export async function fetchCourtsInBounds(
  bbox: CourtBBox,
  options?: FetchCourtsInBoundsOptions
): Promise<CourtsApiResult<Court[]>> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Courts are not configured. Add your Supabase URL and anon key to the .env file.',
    };
  }

  if (!isValidCourtBBox(bbox)) {
    return { ok: false, error: 'Invalid map bounds.' };
  }

  const verifiedOnly = options?.verifiedOnly ?? true;
  const limit = clampCourtsQueryLimit(options?.limit);

  let query = supabase
    .from('courts')
    .select(COURT_SELECT)
    .gte('latitude', bbox.south)
    .lte('latitude', bbox.north)
    .gte('longitude', bbox.west)
    .lte('longitude', bbox.east)
    .order('name', { ascending: true })
    .limit(limit);

  if (verifiedOnly) {
    query = query.eq('verification_status', 'verified');
  }

  const { data, error } = await query;

  if (error) {
    return { ok: false, error: friendlyCourtsError(error.message) };
  }

  const courts =
    (data as CourtRow[] | null)
      ?.map(mapCourtRowToCourt)
      .filter((court): court is Court => court !== null) ?? [];
  return { ok: true, data: courts };
}
