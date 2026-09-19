import type { Region } from 'react-native-maps';

import type { Court } from '@/types';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
] as const;

/** Client abort — Overpass query also sets [timeout:25]. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Extra attempts after the first (total attempts = 1 + MAX_RETRIES). */
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 800;

/** Skip Overpass when the viewport is wider than this (degrees of latitude). */
export const MAX_SEARCH_LATITUDE_DELTA = 0.8;

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

type CacheEntry = {
  courts: Court[];
  savedAt: number;
};

const courtsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export type BBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export function regionToBBox(region: Region): BBox {
  const halfLat = region.latitudeDelta / 2;
  const halfLng = region.longitudeDelta / 2;
  return {
    south: region.latitude - halfLat,
    west: region.longitude - halfLng,
    north: region.latitude + halfLat,
    east: region.longitude + halfLng,
  };
}

export function isRegionTooZoomedOut(region: Region): boolean {
  return region.latitudeDelta > MAX_SEARCH_LATITUDE_DELTA;
}

/** Prototype-style cache key: visible bounds rounded to 2 decimal places. */
export function getBoundsCacheKey(bbox: BBox): string {
  return `${bbox.south.toFixed(2)},${bbox.west.toFixed(2)},${bbox.north.toFixed(2)},${bbox.east.toFixed(2)}`;
}

export function getCachedCourts(region: Region): Court[] | null {
  const key = getBoundsCacheKey(regionToBBox(region));
  const entry = courtsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > CACHE_TTL_MS) {
    courtsCache.delete(key);
    return null;
  }
  return entry.courts;
}

function setCachedCourts(region: Region, courts: Court[]) {
  const key = getBoundsCacheKey(regionToBBox(region));
  courtsCache.set(key, { courts, savedAt: Date.now() });
}

/** Names that are too generic to prefer over place/street context. */
const GENERIC_COURT_NAMES = new Set([
  'basketball court',
  'basketball',
  'court',
  'basketball pitch',
  'pitch',
  'basketball courts',
]);

/** Municipal operators that are not a useful place pin for a specific court. */
const GENERIC_OPERATORS = new Set([
  'nyc parks',
  'new york city department of parks and recreation',
  'department of parks and recreation',
  'parks and recreation',
  'city of new york',
]);

function isGenericCourtName(name: string): boolean {
  return GENERIC_COURT_NAMES.has(name.trim().toLowerCase());
}

function isGenericOperator(value: string): boolean {
  const n = value.trim().toLowerCase();
  if (GENERIC_OPERATORS.has(n)) return true;
  return /\bdepartment of parks\b/i.test(n) || /\bparks and recreation\b/i.test(n);
}

function firstTag(tags: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = tags[key]?.trim();
    if (value) return value;
  }
  return '';
}

function streetFromTags(tags: Record<string, string>): string {
  const street =
    tags['addr:street'] ||
    tags['addr:road'] ||
    tags['contact:street'] ||
    '';
  const number =
    tags['addr:housenumber'] ||
    tags['contact:housenumber'] ||
    '';
  return [number, street].filter(Boolean).join(' ');
}

function cityFromTags(tags: Record<string, string>): string {
  return firstTag(tags, [
    'addr:city',
    'addr:town',
    'addr:village',
    'addr:hamlet',
    'addr:suburb',
    'addr:neighbourhood',
    'addr:neighborhood',
    'addr:district',
    'addr:quarter',
    'is_in:city',
    'is_in:town',
    'is_in:village',
    'is_in:suburb',
    'is_in:municipality',
    'is_in:neighbourhood',
    'is_in:neighborhood',
  ]);
}

function stateFromTags(tags: Record<string, string>): string {
  return firstTag(tags, ['addr:state', 'addr:province', 'is_in:state', 'is_in:province']);
}

/** Park / place context already present on the OSM element (no extra fetch). */
function placeFromTags(tags: Record<string, string>): string {
  const candidates = [
    tags['is_in:park'],
    tags['addr:place'],
    tags['addr:housename'],
    tags.place,
    tags['is_in'],
  ];
  for (const value of candidates) {
    if (value && !isGenericCourtName(value)) return value.trim();
  }
  return '';
}

/** Strip trailing court wording so a real OSM name can double as a location line. */
function locationHintFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || isGenericCourtName(trimmed)) return '';
  const stripped = trimmed
    .replace(/\s+basketball\s+courts?\s*$/i, '')
    .replace(/\s+basketball\s+pitch(es)?\s*$/i, '')
    .replace(/\s+courts?\s*$/i, '')
    .trim();
  return stripped || trimmed;
}

/**
 * Build a display/search location string only from tags on this element.
 * OSM basketball pitches rarely have addr:* — fall back to place / non-generic name / specific operator.
 */
function buildAddress(tags: Record<string, string> | undefined): string {
  if (!tags) return 'Address unavailable';
  if (tags['addr:full']?.trim()) return tags['addr:full'].trim();

  const street = streetFromTags(tags);
  const place = placeFromTags(tags);
  const city = cityFromTags(tags);
  const state = stateFromTags(tags);

  const locality = [city, state].filter(Boolean).join(', ');
  const primary = street || place;
  const parts = [primary, locality].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');

  const namedCandidates = [
    tags.full_name,
    tags.name,
    tags['name:en'],
    tags.official_name,
    tags.alt_name,
    tags.loc_name,
  ];
  for (const candidate of namedCandidates) {
    const hint = candidate ? locationHintFromName(candidate) : '';
    if (hint) return hint;
  }

  const operator = tags.operator?.trim() || tags['operator:short']?.trim() || '';
  if (operator && !isGenericOperator(operator) && !isGenericCourtName(operator)) {
    return operator;
  }

  return 'Address unavailable';
}

/**
 * Prefer a real OSM name; if only generic, build from street/park/place/city tags.
 * Never invent names when no reliable tag context exists.
 */
function buildDisplayName(tags: Record<string, string>): string {
  const namedCandidates = [
    tags.name,
    tags['name:en'],
    tags.official_name,
    tags.alt_name,
    tags.loc_name,
    tags.full_name,
  ].filter(Boolean) as string[];

  for (const candidate of namedCandidates) {
    if (!isGenericCourtName(candidate)) return candidate;
  }

  const street = streetFromTags(tags) || tags['addr:street'] || '';
  const place = placeFromTags(tags);
  const city = cityFromTags(tags);

  if (street) return `Basketball Court on ${street}`;
  if (place) return `Basketball Court · ${place}`;
  if (city) return `Basketball Court · ${city}`;
  return 'Basketball Court';
}

function elementToCourt(el: OverpassElement): Court | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  const tags = el.tags ?? {};

  return {
    id: `osm-${el.type}-${el.id}`,
    name: buildDisplayName(tags),
    latitude: lat,
    longitude: lon,
    address: buildAddress(tags),
    activeGameIds: [],
  };
}

export function dedupeCourts(courts: Court[]): Court[] {
  const seen = new Set<string>();
  const out: Court[] = [];
  for (const court of courts) {
    if (seen.has(court.id)) continue;
    const coordKey = `${court.latitude.toFixed(5)},${court.longitude.toFixed(5)}`;
    if (seen.has(coordKey)) continue;
    seen.add(court.id);
    seen.add(coordKey);
    out.push(court);
  }
  return out;
}

/** Prototype Overpass coverage — one request, uncapped out center. */
function buildOverpassQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  const box = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:25];
(
  node["leisure"="pitch"]["sport"="basketball"](${box});
  way["leisure"="pitch"]["sport"="basketball"](${box});
  node["sport"="basketball"](${box});
);
out center;
`.trim();
}

export type FetchCourtsResult =
  | { ok: true; courts: Court[]; fromCache: boolean }
  | { ok: false; error: string };

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError')
  );
}

function errorMessageForStatus(status: number): string {
  if (status === 429) {
    return 'Court data is rate-limited right now. Try again in a moment.';
  }
  if (status === 503 || status === 502 || status === 504) {
    return 'Court service is busy. Tap retry or pan the map to try again.';
  }
  return 'Could not load courts. Check your connection and try again.';
}

type AttemptResult =
  | { ok: true; courts: Court[] }
  | { ok: false; retryable: boolean; error: string };

async function fetchOnce(
  endpoint: string,
  query: string,
  externalSignal?: AbortSignal
): Promise<AttemptResult> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        retryable,
        error: errorMessageForStatus(response.status),
      };
    }

    const json = (await response.json()) as OverpassResponse;
    const mapped = (json.elements ?? [])
      .map(elementToCourt)
      .filter((c): c is Court => c !== null);
    return { ok: true, courts: dedupeCourts(mapped) };
  } catch (err) {
    if (externalSignal?.aborted) {
      return { ok: false, retryable: false, error: 'Request cancelled.' };
    }
    if (isAbortError(err)) {
      return {
        ok: false,
        retryable: true,
        error: 'Court search timed out. Tap retry or pan the map.',
      };
    }
    return {
      ok: false,
      retryable: true,
      error: 'Could not load courts. Check your connection and try again.',
    };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Fetch courts for the visible region.
 * Uses in-memory bbox cache, client timeout, and retries with backoff on
 * timeouts / 429 / 5xx (rotates Overpass endpoints).
 */
export async function fetchCourtsInRegion(
  region: Region,
  options?: { signal?: AbortSignal }
): Promise<FetchCourtsResult> {
  if (isRegionTooZoomedOut(region)) {
    return { ok: true, courts: [], fromCache: false };
  }

  const cached = getCachedCourts(region);
  if (cached) {
    if (__DEV__) {
      console.log('[courts] cache hit', {
        key: getBoundsCacheKey(regionToBBox(region)),
        count: cached.length,
      });
    }
    return { ok: true, courts: cached, fromCache: true };
  }

  const bbox = regionToBBox(region);
  const query = buildOverpassQuery(bbox);
  const startedAt = Date.now();
  let lastError = 'Could not load courts. Check your connection and try again.';

  if (__DEV__) {
    console.log('[courts] search started', { bbox });
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (options?.signal?.aborted) {
      return { ok: false, error: 'Request cancelled.' };
    }

    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
      if (options?.signal?.aborted) {
        return { ok: false, error: 'Request cancelled.' };
      }
    }

    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    const result = await fetchOnce(endpoint, query, options?.signal);

    if (result.ok) {
      setCachedCourts(region, result.courts);
      if (__DEV__) {
        console.log('[courts] request success', {
          durationMs: Date.now() - startedAt,
          resultCount: result.courts.length,
          attempt: attempt + 1,
          endpoint,
        });
      }
      return { ok: true, courts: result.courts, fromCache: false };
    }

    lastError = result.error;
    if (__DEV__) {
      console.log('[courts] attempt failed', {
        attempt: attempt + 1,
        endpoint,
        error: result.error,
        retryable: result.retryable,
        durationMs: Date.now() - startedAt,
      });
    }

    if (!result.retryable) {
      break;
    }
  }

  return { ok: false, error: lastError };
}

/** Street-suffix tokens ignored so "66 Aberdeen Dr" can match "Aberdeen". */
const QUERY_SKIP_TOKENS = new Set([
  'st',
  'st.',
  'rd',
  'rd.',
  'dr',
  'dr.',
  'ave',
  'ave.',
  'blvd',
  'blvd.',
  'ln',
  'ln.',
  'ct',
  'ct.',
  'way',
  'pl',
  'pl.',
  'pkwy',
  'hwy',
]);

function courtSearchHaystack(court: Court): string {
  const addr = court.address;
  // Ignore placeholder copy so search only matches real name/street/city/place text.
  const searchableAddr =
    !addr || addr === 'Address unavailable' || addr === 'Finding address...' ? '' : addr;
  return `${court.name} ${searchableAddr}`.toLowerCase();
}

/** Significant query tokens: length ≥ 3, not street-suffix abbreviations. */
function significantQueryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,./#+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !QUERY_SKIP_TOKENS.has(t));
}

/**
 * Case-insensitive match on court name + address (street / city / park / place).
 * Full-string substring OR every significant token must appear (so partial street works).
 */
export function filterCourtsByQuery(courts: Court[], query: string): Court[] {
  const q = query.trim().toLowerCase();
  if (!q) return courts;

  const tokens = significantQueryTokens(q);

  return courts.filter((c) => {
    const haystack = courtSearchHaystack(c);
    if (haystack.includes(q)) return true;
    if (tokens.length === 0) return false;
    return tokens.every((token) => haystack.includes(token));
  });
}
