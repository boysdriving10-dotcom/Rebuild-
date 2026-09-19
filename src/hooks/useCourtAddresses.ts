import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatResolvedAddress, reverseGeocode } from '@/data/reverseGeocode';
import type { Court } from '@/types';

export const ADDRESS_UNAVAILABLE = 'Address unavailable';
export const FINDING_ADDRESS = 'Finding address...';

/** Nominatim usage policy: max ~1 request/second. */
const GEOCODE_GAP_MS = 1100;

function needsReverseGeocode(address: string): boolean {
  return !address || address === ADDRESS_UNAVAILABLE;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fills in street/city for courts whose OSM tags had no address, using the
 * existing Nominatim reverseGeocode + geocodeCache. Does not touch Overpass.
 */
export function useCourtAddresses(courts: Court[]): {
  courtsWithAddresses: Court[];
} {
  const [resolvedById, setResolvedById] = useState<Record<string, string>>({});
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());

  const resolvedRef = useRef(resolvedById);
  resolvedRef.current = resolvedById;

  const queuedIdsRef = useRef(new Set<string>());
  const queueRef = useRef<Court[]>([]);
  const pumpingRef = useRef(false);

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;

    try {
      while (queueRef.current.length > 0) {
        const court = queueRef.current.shift();
        if (!court) break;

        setPendingIds((prev) => {
          const next = new Set(prev);
          next.add(court.id);
          return next;
        });

        const result = await reverseGeocode(court.latitude, court.longitude);
        const label = formatResolvedAddress(result) ?? ADDRESS_UNAVAILABLE;

        if (__DEV__) {
          console.log('[useCourtAddresses] resolved', court.id, label);
        }

        setResolvedById((prev) => ({ ...prev, [court.id]: label }));
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(court.id);
          return next;
        });

        if (queueRef.current.length > 0) {
          await delay(GEOCODE_GAP_MS);
        }
      }
    } finally {
      pumpingRef.current = false;
      // If courts were enqueued while we were finishing, start another pass.
      // Without this, those items stay queued forever ("Finding address...").
      if (queueRef.current.length > 0) {
        void pump();
      }
    }
  }, []);

  useEffect(() => {
    let enqueued = false;

    for (const court of courts) {
      if (!needsReverseGeocode(court.address)) continue;
      if (resolvedRef.current[court.id]) continue;
      if (queuedIdsRef.current.has(court.id)) continue;

      queuedIdsRef.current.add(court.id);
      queueRef.current.push(court);
      enqueued = true;
    }

    if (enqueued) {
      void pump();
    }
  }, [courts, pump]);

  const courtsWithAddresses = useMemo(() => {
    return courts.map((court) => {
      if (!needsReverseGeocode(court.address)) return court;

      const resolved = resolvedById[court.id];
      if (resolved) {
        return { ...court, address: resolved };
      }

      if (pendingIds.has(court.id) || queuedIdsRef.current.has(court.id)) {
        return { ...court, address: FINDING_ADDRESS };
      }

      return { ...court, address: FINDING_ADDRESS };
    });
  }, [courts, resolvedById, pendingIds]);

  return { courtsWithAddresses };
}
