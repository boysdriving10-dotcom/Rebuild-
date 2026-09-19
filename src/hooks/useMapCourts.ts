import { useCallback, useEffect, useRef, useState } from 'react';
import type { Region } from 'react-native-maps';

import {
  fetchCourtsInRegion,
  getBoundsCacheKey,
  getCachedCourts,
  isRegionTooZoomedOut,
  regionToBBox,
} from '@/data/overpassCourts';
import type { Court } from '@/types';

const DEBOUNCE_MS = 500;

export type MapCourtsState = {
  courts: Court[];
  loading: boolean;
  error: string | null;
  zoomedOut: boolean;
  retry: () => void;
  onRegionChangeComplete: (region: Region) => void;
};

export function useMapCourts(_initialRegion: Region): MapCourtsState {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedOut, setZoomedOut] = useState(false);

  const regionRef = useRef(_initialRegion);
  const loadingRef = useRef(false);
  const pendingRegionRef = useRef<Region | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (region: Region) => {
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

    const cached = getCachedCourts(region);
    if (cached) {
      setCourts(cached);
      setError(null);
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const result = await fetchCourtsInRegion(region, { signal: controller.signal });

    loadingRef.current = false;
    setLoading(false);

    if (controller.signal.aborted) {
      return;
    }

    if (result.ok) {
      setCourts(result.courts);
      setError(null);
    } else if (result.error !== 'Request cancelled.') {
      setError(result.error);
      if (__DEV__) {
        console.log('[courts] soft failure — keeping existing markers', result.error);
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
    void runSearch(regionRef.current);
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
