import { useCallback, useEffect, useRef, useState } from 'react';
import type { Region } from 'react-native-maps';

import {
  fetchCourtsInRegion,
  getCachedCourts,
  isRegionTooZoomedOut,
  type FetchCourtsResult,
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

export function useMapCourts(initialRegion: Region): MapCourtsState {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomedOut, setZoomedOut] = useState(false);

  const regionRef = useRef(initialRegion);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (region: Region) => {
    regionRef.current = region;

    if (isRegionTooZoomedOut(region)) {
      abortRef.current?.abort();
      setZoomedOut(true);
      setLoading(false);
      setError(null);
      // Keep existing pins visible when zoomed out; do not clear.
      return;
    }

    setZoomedOut(false);

    const cached = getCachedCourts(region);
    if (cached) {
      setCourts(cached);
      setLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);

    const result: FetchCourtsResult = await fetchCourtsInRegion(region, controller.signal);

    if (requestId !== requestIdRef.current) {
      return;
    }

    if (result.ok === false && result.aborted) {
      return;
    }

    setLoading(false);

    if (result.ok === false) {
      setError(result.error);
      return;
    }

    setCourts(result.courts);
    setError(null);
  }, []);

  const onRegionChangeComplete = useCallback(
    (region: Region) => {
      regionRef.current = region;
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
    void runSearch(initialRegion);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
    // Only on mount with initial region
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
