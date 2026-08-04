import type { Region } from 'react-native-maps';

import type { Court } from '@/types';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 50;
/** Skip Overpass when the viewport is wider than this (degrees of latitude). */
export const MAX_SEARCH_LATITUDE_DELTA = 0.35;

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

const regionCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 40;

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

/** Stable cache key for a viewport (rounded by zoom). */
export function getRegionCacheKey(region: Region): string {
  const precision = region.latitudeDelta > 0.15 ? 2 : region.latitudeDelta > 0.05 ? 3 : 4;
  const round = (n: number) => n.toFixed(precision);
  return [
    round(region.latitude),
    round(region.longitude),
    round(region.latitudeDelta),
    round(region.longitudeDelta),
  ].join(':');
}

export function getCachedCourts(region: Region): Court[] | null {
  const key = getRegionCacheKey(region);
  const entry = regionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > CACHE_TTL_MS) {
    regionCache.delete(key);
    return null;
  }
  return entry.courts;
}

function setCachedCourts(region: Region, courts: Court[]) {
  const key = getRegionCacheKey(region);
  regionCache.set(key, { courts, savedAt: Date.now() });
  if (regionCache.size > MAX_CACHE_ENTRIES) {
    const oldest = regionCache.keys().next().value;
    if (oldest) regionCache.delete(oldest);
  }
}

function buildAddress(tags: Record<string, string> | undefined): string {
  if (!tags) return 'Address unavailable';
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const city = tags['addr:city'] || tags['addr:town'] || tags['addr:suburb'] || '';
  const parts = [street, city].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  if (tags['addr:full']) return tags['addr:full'];
  return 'Address unavailable';
}

function elementToCourt(el: OverpassElement): Court | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;

  const tags = el.tags ?? {};
  const name = tags.name || tags['name:en'] || 'Basketball Court';

  return {
    id: `osm-${el.type}-${el.id}`,
    name,
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
    // Also dedupe near-identical coordinates
    const coordKey = `${court.latitude.toFixed(5)},${court.longitude.toFixed(5)}`;
    if (seen.has(coordKey)) continue;
    seen.add(court.id);
    seen.add(coordKey);
    out.push(court);
  }
  return out;
}

function buildOverpassQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  const box = `${south},${west},${north},${east}`;
  return `
[out:json][timeout:10];
(
  node["leisure"="pitch"]["sport"="basketball"](${box});
  way["leisure"="pitch"]["sport"="basketball"](${box});
  relation["leisure"="pitch"]["sport"="basketball"](${box});
  node["sport"="basketball"]["leisure"="sports_centre"](${box});
  way["sport"="basketball"]["leisure"="sports_centre"](${box});
);
out center ${MAX_RESULTS};
`.trim();
}

export type FetchCourtsResult =
  | { ok: true; courts: Court[]; fromCache: boolean }
  | { ok: false; error: string; aborted?: boolean };

export async function fetchCourtsInRegion(
  region: Region,
  signal?: AbortSignal
): Promise<FetchCourtsResult> {
  if (isRegionTooZoomedOut(region)) {
    return { ok: true, courts: [], fromCache: false };
  }

  const cached = getCachedCourts(region);
  if (cached) {
    return { ok: true, courts: cached, fromCache: true };
  }

  const bbox = regionToBBox(region);
  const query = buildOverpassQuery(bbox);

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: 'Could not load courts. Check your connection and try again.' };
    }

    const json = (await response.json()) as OverpassResponse;
    const mapped = (json.elements ?? [])
      .map(elementToCourt)
      .filter((c): c is Court => c !== null);
    const courts = dedupeCourts(mapped).slice(0, MAX_RESULTS);
    setCachedCourts(region, courts);
    return { ok: true, courts, fromCache: false };
  } catch (err) {
    const aborted =
      (err instanceof Error && err.name === 'AbortError') || controller.signal.aborted;
    if (aborted) {
      return { ok: false, error: 'Request cancelled', aborted: true };
    }
    return {
      ok: false,
      error: 'Courts are taking too long to load. Try again.',
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function filterCourtsByQuery(courts: Court[], query: string): Court[] {
  const q = query.trim().toLowerCase();
  if (!q) return courts;
  return courts.filter(
    (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
  );
}
