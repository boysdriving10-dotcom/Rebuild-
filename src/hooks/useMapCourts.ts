import { useCallback, useEffect, useRef, useState } from 'react';
import type { Region } from 'react-native-maps';

import { getFallbackCourtsInBBox } from '@/data/fallbackCourts';
import {
  dedupeCourts,
  fetchCourtsInRegion,
  getBoundsCacheKey,
  isRegionTooZoomedOut,
  regionToBBox,
  withCourtLoadDiag,
  type BBox,
} from '@/data/overpassCourts';
import {
  canIngestDiscoveredCourts,
  fetchCourtsInBounds,
  osmIdentitiesForIngest,
  upsertDiscoveredCourtIds,
} from '@/services/courtsApi';
import type { Court } from '@/types';

function courtsInBBox(courts: Court[], bbox: BBox): Court[] {
  return courts.filter(
    (c) =>
      c.latitude >= bbox.south &&
      c.latitude <= bbox.north &&
      c.longitude >= bbox.west &&
      c.longitude <= bbox.east
  );
}

const DEBOUNCE_MS = 500;
const VERIFIED_CACHE_TTL_MS = 5 * 60 * 1000;

type VerifiedCacheEntry = {
  courts: Court[];
  savedAt: number;
};

/** Memory cache for verified DB courts only — never store raw Overpass pins here. */
const verifiedCourtsCache = new Map<string, VerifiedCacheEntry>();

/**
 * Non-empty verified cache may short-circuit the DB fetch.
 * Empty `[]` must NOT short-circuit — signed-in users still need Overpass discovery.
 * Exported for regression tests (keep in sync with runSearch).
 */
export function shouldUseVerifiedCourtsCacheHit(cached: Court[] | null): boolean {
  return Array.isArray(cached) && cached.length > 0;
}

/**
 * Only non-empty verified DB results are stored in the memory cache.
 * Exported for regression tests (keep in sync with setCachedVerifiedCourts).
 */
export function shouldPersistVerifiedCourtsCache(courts: Court[]): boolean {
  return Array.isArray(courts) && courts.length > 0;
}

/**
 * Guests / signed-out / anonymous must not run Overpass discovery or ingestion.
 * Exported for regression tests.
 */
export function shouldAttemptCourtDiscovery(mayIngest: boolean): boolean {
  return mayIngest === true;
}

function getCachedVerifiedCourts(region: Region): Court[] | null {
  const key = getBoundsCacheKey(regionToBBox(region));
  const entry = verifiedCourtsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > VERIFIED_CACHE_TTL_MS) {
    verifiedCourtsCache.delete(key);
    return null;
  }
  // Treat stale empty entries as a miss (defense in depth if an older build cached []).
  if (!shouldUseVerifiedCourtsCacheHit(entry.courts)) {
    verifiedCourtsCache.delete(key);
    return null;
  }
  return entry.courts;
}

function setCachedVerifiedCourts(region: Region, courts: Court[]) {
  const key = getBoundsCacheKey(regionToBBox(region));
  // Never cache empty verified results — that blocked signed-in discovery (Phase 3 review).
  if (!shouldPersistVerifiedCourtsCache(courts)) {
    verifiedCourtsCache.delete(key);
    return;
  }
  verifiedCourtsCache.set(key, { courts, savedAt: Date.now() });
}

export type MapCourtsState = {
  courts: Court[];
  loading: boolean;
  error: string | null;
  zoomedOut: boolean;
  retry: () => void;
  onRegionChangeComplete: (region: Region) => void;
};

/**
 * Merge verified/live courts with verified fallbacks for the visible bbox.
 * `live` must be verified DB courts (or empty) — never raw Overpass results.
 */
export function mergeCourtsWithFallback(
  existing: Court[],
  live: Court[],
  bbox: BBox
): Court[] {
  const inBoundsExisting = courtsInBBox(existing, bbox);
  const inBoundsLive = courtsInBBox(live, bbox);
  const fallback = getFallbackCourtsInBBox(bbox);
  return dedupeCourts([...inBoundsLive, ...inBoundsExisting, ...fallback]);
}

export function useMapCourts(_initialRegion: Region): MapCourtsState {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedOut, setZoomedOut] = useState(false);

  const regionRef = useRef(_initialRegion);
  const courtsRef = useRef<Court[]>([]);
  const loadingRef = useRef(false);
  const pendingRegionRef = useRef<Region | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Monotonic id so only the latest in-flight search may update success/error UI. */
  const searchIdRef = useRef(0);

  const applyVerifiedToMap = useCallback(
    (region: Region, verified: Court[], showDiag: boolean, emptyDiag?: string | null) => {
      const bbox = regionToBBox(region);
      const next = mergeCourtsWithFallback(courtsRef.current, verified, bbox);
      courtsRef.current = next;
      setCourts(next);
      if (next.length > 0) {
        setError(null);
      } else if (showDiag && emptyDiag) {
        setError(withCourtLoadDiag('No courts found nearby', emptyDiag));
      } else {
        setError(null);
      }
    },
    []
  );

  const runSearch = useCallback(async (region: Region, opts?: { force?: boolean }) => {
    regionRef.current = region;

    if (isRegionTooZoomedOut(region)) {
      setZoomedOut(true);
      setError(null);
      return;
    }

    setZoomedOut(false);

    // If busy, queue latest area — do not abort mid-flight (keeps markers stable).
    if (loadingRef.current) {
      pendingRegionRef.current = region;
      if (__DEV__) {
        console.log('[courts] search skipped because another request is loading', {
          key: getBoundsCacheKey(regionToBBox(region)),
        });
      }
      return;
    }

    // Retry (`force`) must hit the network — do not short-circuit on memory cache.
    // Non-empty verified cache only — empty must not block signed-in discovery/ingest.
    const cached = !opts?.force ? getCachedVerifiedCourts(region) : null;
    if (shouldUseVerifiedCourtsCacheHit(cached)) {
      const bbox = regionToBBox(region);
      const next = mergeCourtsWithFallback([], cached as Court[], bbox);
      courtsRef.current = next;
      setCourts(next);
      setError(null);
      return;
    }

    const searchId = ++searchIdRef.current;
    loadingRef.current = true;
    setLoading(true);
    // Clear error only when starting a fresh attempt with nothing on the map yet.
    // Keep success UI if markers are already showing (avoids Retry flash from follow-ups).
    if (courtsRef.current.length === 0) {
      setError(null);
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const showDiag = !!opts?.force;
    const bbox = regionToBBox(region);

    // 1) Load verified courts from public.courts (primary map source).
    const dbResult = await fetchCourtsInBounds(bbox);

    if (searchId !== searchIdRef.current || controller.signal.aborted) {
      loadingRef.current = false;
      setLoading(false);
      return;
    }

    let verified: Court[] = [];

    if (dbResult.ok) {
      verified = dbResult.data;
      setCachedVerifiedCourts(region, verified);
      applyVerifiedToMap(region, verified, showDiag, verified.length === 0 ? 'empty@db' : null);
    } else {
      // Soft failure: keep in-bounds pins + verified fallback for these bounds.
      const next = mergeCourtsWithFallback(courtsRef.current, [], bbox);

      if (next.length > 0) {
        courtsRef.current = next;
        setCourts(next);
        setError(null);
        if (__DEV__) {
          console.log('[courts] DB load failed — showing in-bounds courts', {
            count: next.length,
            error: dbResult.error,
          });
        }
      } else {
        courtsRef.current = [];
        setCourts([]);
        setError(showDiag ? withCourtLoadDiag(dbResult.error, 'db') : dbResult.error);
      }
    }

    // End primary loading so the map is usable before optional discovery.
    loadingRef.current = false;
    setLoading(false);

    const justKey = getBoundsCacheKey(bbox);

    // If the user already moved on during the DB fetch, search that area next
    // instead of spending Overpass budget on a stale viewport.
    const pendingAfterDb = pendingRegionRef.current;
    if (pendingAfterDb) {
      const pendingKey = getBoundsCacheKey(regionToBBox(pendingAfterDb));
      if (pendingKey !== justKey) {
        pendingRegionRef.current = null;
        void runSearch(pendingAfterDb);
        return;
      }
      pendingRegionRef.current = null;
    }

    // 2–5) Signed-in non-anonymous: Overpass for OSM IDs only → Edge Function → refetch DB.
    // Guests / signed-out / anonymous browse verified courts without ingestion.
    // Never display raw Overpass results as verified pins.
    if (!controller.signal.aborted && searchId === searchIdRef.current) {
      const mayIngest = await canIngestDiscoveredCourts();

      if (
        shouldAttemptCourtDiscovery(mayIngest) &&
        !controller.signal.aborted &&
        searchId === searchIdRef.current
      ) {
        const discovery = await fetchCourtsInRegion(region, {
          signal: controller.signal,
          force: opts?.force,
        });

        if (
          discovery.ok &&
          !controller.signal.aborted &&
          searchId === searchIdRef.current
        ) {
          const knownIds = verified.map((c) => c.id);
          const elements = osmIdentitiesForIngest(
            discovery.courts.map((c) => c.id),
            knownIds
          );

          if (elements.length > 0) {
            const ingest = await upsertDiscoveredCourtIds(elements);

            if (
              ingest.ok &&
              !controller.signal.aborted &&
              searchId === searchIdRef.current
            ) {
              // 5) After ingestion, fetch verified courts again and update the map.
              const refreshed = await fetchCourtsInBounds(bbox);
              if (
                refreshed.ok &&
                !controller.signal.aborted &&
                searchId === searchIdRef.current
              ) {
                setCachedVerifiedCourts(region, refreshed.data);
                applyVerifiedToMap(region, refreshed.data, false, null);
              }
            } else if (__DEV__ && !ingest.ok) {
              console.log('[courts] ingest skipped or failed', { error: ingest.error });
            }
          }
        } else if (__DEV__ && !discovery.ok && discovery.error !== 'Request cancelled.') {
          console.log('[courts] Overpass discovery failed — keeping verified courts', {
            error: discovery.error,
            diag: discovery.diag,
          });
        }
      }
    }

    // If the user settled on a newer area during discovery/ingest, search that next.
    const pending = pendingRegionRef.current;
    pendingRegionRef.current = null;
    if (pending) {
      const pendingKey = getBoundsCacheKey(regionToBBox(pending));
      if (pendingKey !== justKey) {
        void runSearch(pending);
      }
    }
  }, [applyVerifiedToMap]);

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      regionRef.current = region;

      if (__DEV__) {
        console.log('[courts] region settled', {
          key: getBoundsCacheKey(regionToBBox(region)),
          latitudeDelta: region.latitudeDelta,
        });
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runSearch(region);
      }, DEBOUNCE_MS);
    },
    [runSearch]
  );

  const retry = useCallback(() => {
    // Deliberate Retry: bypass Overpass cooldown for one network attempt.
    void runSearch(regionRef.current, { force: true });
  }, [runSearch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    courts,
    loading,
    error,
    zoomedOut,
    retry,
    onRegionChangeComplete,
  };
}
