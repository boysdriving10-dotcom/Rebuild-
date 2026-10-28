import { useCallback, useEffect, useRef, useState } from 'react';
import type { Region } from 'react-native-maps';

import { getFallbackCourtsInBBox } from '@/data/fallbackCourts';
import {
  dedupeCourts,
  fetchCourtsInRegion,
  getBoundsCacheKey,
  getCachedCourts,
  isRegionTooZoomedOut,
  regionToBBox,
  withCourtLoadDiag,
  type BBox,
} from '@/data/overpassCourts';
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

export type MapCourtsState = {
  courts: Court[];
  loading: boolean;
  error: string | null;
  zoomedOut: boolean;
  retry: () => void;
  onRegionChangeComplete: (region: Region) => void;
};

/**
 * Merge live/cached courts with verified fallbacks for the visible bbox.
 * Used on Overpass failure and on empty Overpass success so the map is not blank.
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
    const cached = !opts?.force ? getCachedCourts(region) : null;
    if (cached) {
      // Cache holds live Overpass results only — merge once as `live`, not as both args.
      const bbox = regionToBBox(region);
      const next = mergeCourtsWithFallback([], cached, bbox);
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

    const result = await fetchCourtsInRegion(region, {
      signal: controller.signal,
      force: opts?.force,
    });

    loadingRef.current = false;
    setLoading(false);

    // Stale / superseded / cancelled — do not overwrite a newer success.
    if (searchId !== searchIdRef.current || controller.signal.aborted) {
      return;
    }

    const bbox = regionToBBox(region);

    const showDiag = !!opts?.force;

    if (result.ok) {
      // Always union live results with verified in-bounds fallbacks (deduped).
      // Volpa has no OSM pitch — fallback is the only way it appears.
      const next = mergeCourtsWithFallback(courtsRef.current, result.courts, bbox);
      courtsRef.current = next;
      setCourts(next);
      if (next.length > 0) {
        setError(null);
      } else if (showDiag && result.emptyDiag) {
        // Retry got HTTP 200 with no usable courts and no in-bounds fallbacks.
        setError(
          withCourtLoadDiag('No courts found nearby', result.emptyDiag)
        );
      } else {
        setError(null);
      }
    } else if (result.error !== 'Request cancelled.') {
      // Soft failure: keep in-bounds pins + verified fallback for these bounds.
      const next = mergeCourtsWithFallback(courtsRef.current, [], bbox);

      if (next.length > 0) {
        courtsRef.current = next;
        setCourts(next);
        setError(null);
        if (__DEV__) {
          console.log('[courts] Overpass failed — showing in-bounds courts', {
            count: next.length,
            error: result.error,
            diag: result.diag,
          });
        }
      } else {
        // Nothing valid for this viewport — drop stale out-of-area pins.
        courtsRef.current = [];
        setCourts([]);
        // Production/TestFlight: attach safe diag only after an explicit Retry.
        setError(
          showDiag ? withCourtLoadDiag(result.error, result.diag) : result.error
        );
      }
    }

    // If the user settled on a newer area while we were loading, search that next.
    const pending = pendingRegionRef.current;
    pendingRegionRef.current = null;
    if (pending) {
      const pendingKey = getBoundsCacheKey(regionToBBox(pending));
      const justKey = getBoundsCacheKey(regionToBBox(region));
      if (pendingKey !== justKey) {
        void runSearch(pending);
      }
    }
  }, []);

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
