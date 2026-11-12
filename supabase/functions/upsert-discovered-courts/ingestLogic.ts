/** Pure ingest helpers shared by the Edge Function and offline tests. */

export const MAX_OSM_IDS_PER_REQUEST = 40;
export const RATE_LIMIT_MAX_REQUESTS = 10;
export const RATE_LIMIT_WINDOW_SECONDS = 600;
export const GLOBAL_RATE_LIMIT_MAX_REQUESTS = 100;
export const GLOBAL_RATE_LIMIT_WINDOW_SECONDS = 600;
/** Re-fetch existing verified courts at most once per week. */
export const COURT_REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const OVERPASS_TIMEOUT_MS = 15_000;

/** Leisure values that credibly describe a basketball court / pitch facility. */
const CREDIBLE_COURT_LEISURE = new Set([
  'pitch',
  'sports_centre',
  'stadium',
  'recreation_ground',
  'fitness_centre',
]);

/** Amenities that are compatible with a court mapped on shared community facilities. */
const COMPATIBLE_AMENITIES = new Set([
  'community_centre',
  'social_facility',
  'public_building',
]);

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
  updated_at: string;
};

export type CourtVerificationStatus = 'unverified' | 'verified' | 'rejected';

export type ExistingCourtRecord = {
  source_id: string;
  updatedAtMs: number | null;
  verification_status: CourtVerificationStatus | null;
};

/** True when the partitioned fetch set requires an Overpass round-trip (and thus global budget). */
export function needsOverpassFetch(toFetchCount: number): boolean {
  return toFetchCount > 0;
}

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

function sportTokensFromTags(tags: Record<string, string>): string[] {
  return (tags.sport ?? '')
    .toLowerCase()
    .split(/[;|,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * True when OSM tags establish credible basketball court / pitch evidence.
 * Requires sport=basketball plus a pitch-like leisure tag, or a bare
 * sport=basketball element that is not tagged as an unrelated POI.
 */
export function hasBasketballEvidence(tags: Record<string, string> | undefined | null): boolean {
  if (!tags || typeof tags !== 'object') return false;

  const sportTokens = sportTokensFromTags(tags);
  if (!sportTokens.includes('basketball')) return false;

  const leisure = (tags.leisure ?? '').toLowerCase().trim();
  if (leisure) {
    return CREDIBLE_COURT_LEISURE.has(leisure);
  }

  // Bare sport=basketball nodes/ways are common legitimate courts in OSM
  // (and match map discovery). Reject when tagged as a commercial/tourist POI.
  const shop = (tags.shop ?? '').toLowerCase().trim();
  const tourism = (tags.tourism ?? '').toLowerCase().trim();
  const office = (tags.office ?? '').toLowerCase().trim();
  const craft = (tags.craft ?? '').toLowerCase().trim();
  if (shop || tourism || office || craft) return false;

  const amenity = (tags.amenity ?? '').toLowerCase().trim();
  if (amenity && !COMPATIBLE_AMENITIES.has(amenity)) return false;

  return true;
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
export function courtRowFromOverpassElement(
  el: OverpassElement,
  nowIso: string = new Date().toISOString()
): CourtUpsertRow | null {
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
    updated_at: nowIso,
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
export function decideUserAuth(
  user:
    | {
        id?: string | null;
        role?: string | null;
        is_anonymous?: boolean | null;
      }
    | null
    | undefined
): AuthDecision {
  if (!user || typeof user.id !== 'string' || user.id.length === 0) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }
  // Reject anon JWT role, literal anonymous id, and Supabase Anonymous Sign-In users.
  if (user.role === 'anon' || user.id === 'anonymous' || user.is_anonymous === true) {
    return { ok: false, status: 401, error: 'anonymous_not_allowed' };
  }
  return { ok: true, userId: user.id };
}

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  request_count: number;
  global_remaining?: number;
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
    global_remaining: typeof row.global_remaining === 'number' ? row.global_remaining : undefined,
    reason: typeof row.reason === 'string' ? row.reason : undefined,
  };
}

export type RateLimitWindowState = {
  windowStartedAtMs: number;
  requestCount: number;
};

/** Simulate a fixed window counter (mirrors SQL per-bucket semantics). */
export function applyRateLimitWindow(
  state: RateLimitWindowState | null,
  nowMs: number,
  maxRequests: number,
  windowMs: number,
  blockedReason: string
): {
  next: RateLimitWindowState;
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
        reason: blockedReason,
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

/**
 * Simulate combined global + per-user limits (global checked first; user block
 * does not consume global — mirrors SQL).
 */
export function applyCombinedRateLimits(
  globalState: RateLimitWindowState | null,
  userState: RateLimitWindowState | null,
  nowMs: number,
  opts: {
    userMax?: number;
    userWindowMs?: number;
    globalMax?: number;
    globalWindowMs?: number;
  } = {}
): {
  nextGlobal: RateLimitWindowState;
  nextUser: RateLimitWindowState;
  decision: RateLimitDecision;
} {
  const userMax = opts.userMax ?? RATE_LIMIT_MAX_REQUESTS;
  const userWindowMs = opts.userWindowMs ?? RATE_LIMIT_WINDOW_SECONDS * 1000;
  const globalMax = opts.globalMax ?? GLOBAL_RATE_LIMIT_MAX_REQUESTS;
  const globalWindowMs = opts.globalWindowMs ?? GLOBAL_RATE_LIMIT_WINDOW_SECONDS * 1000;

  const globalProbe = applyRateLimitWindow(
    globalState,
    nowMs,
    globalMax,
    globalWindowMs,
    'global_rate_limited'
  );
  if (!globalProbe.decision.allowed) {
    return {
      nextGlobal: globalProbe.next,
      nextUser: userState ?? { windowStartedAtMs: nowMs, requestCount: 0 },
      decision: {
        ...globalProbe.decision,
        global_remaining: 0,
      },
    };
  }

  // Peek user limit without yet committing global — if user blocked, revert global consume.
  let userWindowStartedAtMs = userState?.windowStartedAtMs ?? nowMs;
  let userCount = userState?.requestCount ?? 0;
  if (!userState || userWindowStartedAtMs <= nowMs - userWindowMs) {
    userWindowStartedAtMs = nowMs;
    userCount = 0;
  }
  if (userCount >= userMax) {
    // Restore global to pre-consume state.
    const restoredGlobal = globalState ?? { windowStartedAtMs: nowMs, requestCount: 0 };
    let gStarted = restoredGlobal.windowStartedAtMs;
    let gCount = restoredGlobal.requestCount;
    if (!globalState || gStarted <= nowMs - globalWindowMs) {
      gStarted = nowMs;
      gCount = 0;
    }
    return {
      nextGlobal: { windowStartedAtMs: gStarted, requestCount: gCount },
      nextUser: { windowStartedAtMs: userWindowStartedAtMs, requestCount: userCount },
      decision: {
        allowed: false,
        remaining: 0,
        request_count: userCount,
        global_remaining: Math.max(globalMax - gCount, 0),
        reason: 'rate_limited',
      },
    };
  }

  userCount += 1;
  return {
    nextGlobal: globalProbe.next,
    nextUser: { windowStartedAtMs: userWindowStartedAtMs, requestCount: userCount },
    decision: {
      allowed: true,
      remaining: Math.max(userMax - userCount, 0),
      request_count: userCount,
      global_remaining: globalProbe.decision.remaining,
    },
  };
}

export type ExistingLookupResult =
  | { ok: true; bySourceId: Map<string, ExistingCourtRecord> }
  | { ok: false; error: 'lookup_failed' };

function parseVerificationStatus(value: unknown): CourtVerificationStatus | null {
  if (value === 'unverified' || value === 'verified' || value === 'rejected') {
    return value;
  }
  return null;
}

/** Parse a courts select payload into an existing-record map (fail closed on bad input). */
export function parseExistingCourtsLookup(data: unknown, error: unknown): ExistingLookupResult {
  if (error) {
    return { ok: false, error: 'lookup_failed' };
  }
  if (!Array.isArray(data)) {
    return { ok: false, error: 'lookup_failed' };
  }

  const bySourceId = new Map<string, ExistingCourtRecord>();
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const sourceId = (row as { source_id?: unknown }).source_id;
    if (typeof sourceId !== 'string' || sourceId.length === 0) continue;
    const updatedRaw = (row as { updated_at?: unknown }).updated_at;
    let updatedAtMs: number | null = null;
    if (typeof updatedRaw === 'string' || typeof updatedRaw === 'number') {
      const parsed = new Date(updatedRaw).getTime();
      updatedAtMs = Number.isFinite(parsed) ? parsed : null;
    }
    const verification_status = parseVerificationStatus(
      (row as { verification_status?: unknown }).verification_status
    );
    bySourceId.set(sourceId, { source_id: sourceId, updatedAtMs, verification_status });
  }
  return { ok: true, bySourceId };
}

/**
 * Decide which IDs need Overpass:
 * - missing → fetch (new)
 * - rejected → never fetch / never upsert (preserve rejection)
 * - verified + fresh → skip
 * - verified + stale → refresh fetch
 * - unverified → fetch so Overpass can promote to verified (never weaken)
 */
export function partitionIdentitiesForFetch(
  identities: OsmIdentity[],
  existing: Map<string, ExistingCourtRecord>,
  nowMs: number,
  refreshAfterMs: number = COURT_REFRESH_AFTER_MS
): {
  toFetch: OsmIdentity[];
  skippedFresh: number;
  skippedRejected: number;
  refreshCount: number;
} {
  const toFetch: OsmIdentity[] = [];
  let skippedFresh = 0;
  let skippedRejected = 0;
  let refreshCount = 0;

  for (const identity of identities) {
    const key = sourceIdKey(identity.type, identity.id);
    const record = existing.get(key);
    if (!record) {
      toFetch.push(identity);
      continue;
    }

    if (record.verification_status === 'rejected') {
      skippedRejected += 1;
      continue;
    }

    if (record.verification_status === 'unverified' || record.verification_status == null) {
      // Allow Overpass to strengthen unverified → verified; never write a weaker status.
      toFetch.push(identity);
      continue;
    }

    // verified (or unexpected status treated cautiously via updated_at freshness)
    const updatedAtMs = record.updatedAtMs;
    const isStale =
      updatedAtMs == null || !Number.isFinite(updatedAtMs) || nowMs - updatedAtMs >= refreshAfterMs;
    if (isStale) {
      toFetch.push(identity);
      refreshCount += 1;
    } else {
      skippedFresh += 1;
    }
  }

  return { toFetch, skippedFresh, skippedRejected, refreshCount };
}
