import type { Region } from 'react-native-maps';

import type { Court } from '@/types';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
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

/**
 * Fetch courts for the visible region.
 * No short client abort — lets the 25s Overpass server timeout finish.
 * No silent retries / failover (prototype behavior).
 */
export async function fetchCourtsInRegion(region: Region): Promise<FetchCourtsResult> {
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

  if (__DEV__) {
    console.log('[courts] search started', { bbox });
  }

  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (!response.ok) {
      if (__DEV__) {
        console.log('[courts] request failure', {
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
      }
      return {
        ok: false,
        error: 'Could not load courts. Check your connection and try again.',
      };
    }

    const json = (await response.json()) as OverpassResponse;
    const mapped = (json.elements ?? [])
      .map(elementToCourt)
      .filter((c): c is Court => c !== null);
    const courts = dedupeCourts(mapped);
    setCachedCourts(region, courts);

    if (__DEV__) {
      console.log('[courts] request success', {
        durationMs: Date.now() - startedAt,
        resultCount: courts.length,
      });
    }

    return { ok: true, courts, fromCache: false };
  } catch (err) {
    if (__DEV__) {
      console.log('[courts] request failure', {
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      });
    }
    return {
      ok: false,
      error: 'Could not load courts. Check your connection and try again.',
    };
  }
}

export function filterCourtsByQuery(courts: Court[], query: string): Court[] {
  const q = query.trim().toLowerCase();
  if (!q) return courts;
  return courts.filter(
    (c) => c.name.toLowerCase().includes(q) || c.address.toLowerCase().includes(q)
  );
}
