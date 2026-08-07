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
  zoomedOut: boolean;
  onRegionChangeComplete: (region: Region) => void;
};

export function useMapCourts(_initialRegion: Region): MapCourtsState {
  const [courts, setCourts] = useState<Court[]>([]);
  const [loading, setLoading] = useState(false);
  const [zoomedOut, setZoomedOut] = useState(false);

  const regionRef = useRef(_initialRegion);
  const loadingRef = useRef(false);
  const pendingRegionRef = useRef<Region | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (region: Region) => {
    regionRef.current = region;

    if (isRegionTooZoomedOut(region)) {
      setZoomedOut(true);
      return;
    }

    setZoomedOut(false);

    // Prototype concurrency: if busy, skip — do not abort. Queue latest area.
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
      return;
    }

    loadingRef.current = true;
    setLoading(true);

    const result = await fetchCourtsInRegion(region);

    loadingRef.current = false;
    setLoading(false);

    if (result.ok) {
      // Keep prior markers on empty failure paths; on success replace with viewport results.
      setCourts(result.courts);
    } else if (__DEV__) {
      console.log('[courts] soft failure — keeping existing markers');
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

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return {
    courts,
    loading,
    zoomedOut,
    onRegionChangeComplete,
  };
}
