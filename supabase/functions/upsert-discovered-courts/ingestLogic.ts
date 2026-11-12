/** Pure ingest helpers shared by the Edge Function and offline tests. */

export const MAX_OSM_IDS_PER_REQUEST = 40;
export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_WINDOW_SECONDS = 600;
export const OVERPASS_TIMEOUT_MS = 15_000;

export type OsmElementType = 'node' | 'way';

export type OsmIdentity = {
  type: OsmElementType;
  id: number;
};

export type OverpassElement = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

export type CourtUpsertRow = {
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  source: 'overpass';
  source_id: string;
  verification_status: 'verified';
};

export function parseOsmIdentities(input: unknown): {
  identities: OsmIdentity[];
  rejected: number;
} {
  if (!Array.isArray(input)) {
    return { identities: [], rejected: 0 };
  }

  const seen = new Set<string>();
  const identities: OsmIdentity[] = [];
  let rejected = 0;

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      rejected += 1;
      continue;
    }
    const raw = item as { type?: unknown; id?: unknown };
    const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
    const idNum =
      typeof raw.id === 'number'
        ? raw.id
        : typeof raw.id === 'string' && /^\d+$/.test(raw.id.trim())
          ? Number(raw.id.trim())
          : NaN;

    if ((type !== 'node' && type !== 'way') || !Number.isInteger(idNum) || idNum <= 0) {
      rejected += 1;
      continue;
    }

    const key = `${type}/${idNum}`;
    if (seen.has(key)) {
      // Duplicate in the same request — skipped later, not rejected.
      continue;
    }
    seen.add(key);
    identities.push({ type, id: idNum });
  }

  return { identities, rejected };
}

export function enforceIdCap(identities: OsmIdentity[]): {
  accepted: OsmIdentity[];
  truncated: number;
} {
  if (identities.length <= MAX_OSM_IDS_PER_REQUEST) {
    return { accepted: identities, truncated: 0 };
  }
  return {
    accepted: identities.slice(0, MAX_OSM_IDS_PER_REQUEST),
    truncated: identities.length - MAX_OSM_IDS_PER_REQUEST,
  };
}

/** True when OSM tags establish basketball-specific evidence. */
export function hasBasketballEvidence(tags: Record<string, string> | undefined | null): boolean {
  if (!tags || typeof tags !== 'object') return false;

  const sport = (tags.sport ?? '').toLowerCase();
  const sportTokens = sport
    .split(/[;|,]/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (sportTokens.includes('basketball')) return true;

  // Explicit pitch typed as basketball via combined tags already covered by sport.
  // Also accept leisure=pitch with basketball in sport (handled above).
  const leisure = (tags.leisure ?? '').toLowerCase();
  if (leisure === 'pitch' && sportTokens.includes('basketball')) return true;

  return false;
}

export function coordsFromElement(el: OverpassElement): { latitude: number; longitude: number } | null {
  const latitude = el.lat ?? el.center?.lat;
  const longitude = el.lon ?? el.center?.lon;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  // Reject null-island style junk.
  if (latitude === 0 && longitude === 0) return null;
  return { latitude, longitude };
}

function firstTag(tags: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function displayNameFromTags(tags: Record<string, string>): string {
  const named = firstTag(tags, ['name', 'name:en', 'official_name', 'alt_name', 'loc_name']);
  if (named) return named;
  return 'Basketball Court';
}

export function addressFromTags(tags: Record<string, string>): string | null {
  const full = tags['addr:full']?.trim();
  if (full) return full;
  const number = tags['addr:housenumber']?.trim() ?? '';
  const street = tags['addr:street']?.trim() ?? '';
  const line = [number, street].filter(Boolean).join(' ').trim();
  const city = firstTag(tags, ['addr:city', 'addr:town', 'addr:village']);
  const state = firstTag(tags, ['addr:state', 'addr:province']);
  const locality = [city, state].filter(Boolean).join(', ');
  const parts = [line || null, locality || null].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Build a verified upsert row from a trusted Overpass element, or null if rejected.
 */
export function courtRowFromOverpassElement(el: OverpassElement): CourtUpsertRow | null {
  const type = el.type === 'node' || el.type === 'way' ? el.type : null;
  const id = typeof el.id === 'number' && Number.isInteger(el.id) && el.id > 0 ? el.id : null;
  if (!type || id == null) return null;

  if (!hasBasketballEvidence(el.tags)) return null;

  const coords = coordsFromElement(el);
  if (!coords) return null;

  const tags = el.tags ?? {};
  return {
    name: displayNameFromTags(tags),
    latitude: coords.latitude,
    longitude: coords.longitude,
    address: addressFromTags(tags),
    city: firstTag(tags, ['addr:city', 'addr:town', 'addr:village']),
    region: firstTag(tags, ['addr:state', 'addr:province']),
    country: firstTag(tags, ['addr:country', 'is_in:country_code', 'is_in:country']),
    source: 'overpass',
    source_id: `${type}/${id}`,
    verification_status: 'verified',
  };
}

export function buildOverpassIdsQuery(identities: OsmIdentity[]): string {
  const nodeIds = identities.filter((i) => i.type === 'node').map((i) => i.id);
  const wayIds = identities.filter((i) => i.type === 'way').map((i) => i.id);
  const parts: string[] = [];
  if (nodeIds.length > 0) parts.push(`  node(id:${nodeIds.join(',')});`);
  if (wayIds.length > 0) parts.push(`  way(id:${wayIds.join(',')});`);
  return `
[out:json][timeout:25];
(
${parts.join('\n')}
);
out center;
`.trim();
}

export function sourceIdKey(type: OsmElementType, id: number): string {
  return `${type}/${id}`;
}

export type AuthDecision =
  | { ok: true; userId: string }
  | { ok: false; status: 401; error: 'unauthorized' | 'anonymous_not_allowed' };

/** Decide auth from a Supabase getUser-style result. */
export function decideUserAuth(user: { id?: string | null; role?: string | null } | null | undefined): AuthDecision {
  if (!user || typeof user.id !== 'string' || user.id.length === 0) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  // Reject explicitly anonymous JWT subjects if present.
  if (user.role === 'anon' || user.id === 'anonymous') {
    return { ok: false, status: 401, error: 'anonymous_not_allowed' };
  }
  return { ok: true, userId: user.id };
}

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  request_count: number;
  reason?: string;
};

export function interpretRateLimitResult(data: unknown): RateLimitDecision {
  if (!data || typeof data !== 'object') {
    return { allowed: false, remaining: 0, request_count: 0, reason: 'rate_limit_unavailable' };
  }
  const row = data as Record<string, unknown>;
  return {
    allowed: row.allowed === true,
    remaining: typeof row.remaining === 'number' ? row.remaining : 0,
    request_count: typeof row.request_count === 'number' ? row.request_count : 0,
    reason: typeof row.reason === 'string' ? row.reason : undefined,
  };
}

/** Simulate the atomic window counter for offline tests (mirrors SQL semantics). */
export function applyRateLimitWindow(state: {
  windowStartedAtMs: number;
  requestCount: number;
} | null, nowMs: number, maxRequests = RATE_LIMIT_MAX_REQUESTS, windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000): {
  next: { windowStartedAtMs: number; requestCount: number };
  decision: RateLimitDecision;
} {
  let windowStartedAtMs = state?.windowStartedAtMs ?? nowMs;
  let requestCount = state?.requestCount ?? 0;

  if (!state || windowStartedAtMs <= nowMs - windowMs) {
    windowStartedAtMs = nowMs;
    requestCount = 0;
  }

  if (requestCount >= maxRequests) {
    return {
      next: { windowStartedAtMs, requestCount },
      decision: {
        allowed: false,
        remaining: 0,
        request_count: requestCount,
        reason: 'rate_limited',
      },
    };
  }

  requestCount += 1;
  return {
    next: { windowStartedAtMs, requestCount },
    decision: {
      allowed: true,
      remaining: Math.max(maxRequests - requestCount, 0),
      request_count: requestCount,
    },
  };
}
