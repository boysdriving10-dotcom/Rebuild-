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
 * Fetch verified courts whose coordinates fall inside the visible map bounds.
 * Primary map source — Overpass is discovery-only and must not be shown as verified.
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

/** App Court.id form produced by Overpass / DB mapper, e.g. osm-node-123. */
const OSM_COURT_ID_RE = /^osm-(node|way)-(\d+)$/;

export type OsmCourtIdentity = { type: 'node' | 'way'; id: number };

/**
 * Parse an app Court.id back to an OSM identity for the ingest Edge Function.
 * Returns null for fallback/manual/malformed ids — never invents identities.
 */
export function parseOsmCourtId(courtId: string): OsmCourtIdentity | null {
  if (typeof courtId !== 'string') return null;
  const match = OSM_COURT_ID_RE.exec(courtId.trim());
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { type: match[1] as 'node' | 'way', id };
}

/** Cap matches the Edge Function MAX_OSM_IDS_PER_REQUEST. */
export const DISCOVERED_COURT_ID_CAP = 40;

/**
 * Extract unique OSM node/way identities from Overpass discovery Court ids.
 * Skips ids already present in `alreadyKnownIds` (typically verified DB pins).
 */
export function osmIdentitiesForIngest(
  discoveredCourtIds: string[],
  alreadyKnownIds?: Iterable<string>
): OsmCourtIdentity[] {
  const known = new Set(alreadyKnownIds ?? []);
  const seen = new Set<string>();
  const out: OsmCourtIdentity[] = [];

  for (const courtId of discoveredCourtIds) {
    if (known.has(courtId)) continue;
    const parsed = parseOsmCourtId(courtId);
    if (!parsed) continue;
    const key = `${parsed.type}/${parsed.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
    if (out.length >= DISCOVERED_COURT_ID_CAP) break;
  }

  return out;
}

/**
 * True when the current session may call upsert-discovered-courts:
 * configured Supabase, signed-in, and not an anonymous user.
 * Guests / signed-out / anonymous must browse verified courts only.
 */
export async function canIngestDiscoveredCourts(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return false;
  if (user.is_anonymous === true) return false;
  return true;
}

export type UpsertDiscoveredCourtsData = {
  inserted: number;
  skipped: number;
  rejected: number;
  refreshed?: number;
  remaining?: number;
};

/**
 * Send OSM identities only to the upsert-discovered-courts Edge Function.
 * Never writes to public.courts from the client. No-ops for guests/anonymous.
 */
export async function upsertDiscoveredCourtIds(
  elements: OsmCourtIdentity[]
): Promise<CourtsApiResult<UpsertDiscoveredCourtsData>> {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      error: 'Courts are not configured. Add your Supabase URL and anon key to the .env file.',
    };
  }

  const allowed = await canIngestDiscoveredCourts();
  if (!allowed) {
    return { ok: false, error: 'Sign in required to discover courts.' };
  }

  if (!Array.isArray(elements) || elements.length === 0) {
    return { ok: true, data: { inserted: 0, skipped: 0, rejected: 0 } };
  }

  const capped = elements.slice(0, DISCOVERED_COURT_ID_CAP);

  const { data, error } = await supabase.functions.invoke('upsert-discovered-courts', {
    body: { elements: capped },
  });

  if (error) {
    return { ok: false, error: friendlyCourtsError(error.message) };
  }

  const payload = data as
    | (UpsertDiscoveredCourtsData & { ok?: boolean; error?: string })
    | null;

  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Unexpected response from court discovery.' };
  }

  if (payload.ok === false) {
    return {
      ok: false,
      error: friendlyCourtsError(
        typeof payload.error === 'string' ? payload.error : 'Court discovery failed.'
      ),
    };
  }

  return {
    ok: true,
    data: {
      inserted: Number(payload.inserted) || 0,
      skipped: Number(payload.skipped) || 0,
      rejected: Number(payload.rejected) || 0,
      refreshed:
        typeof payload.refreshed === 'number' ? payload.refreshed : undefined,
      remaining:
        typeof payload.remaining === 'number' ? payload.remaining : undefined,
    },
  };
}
