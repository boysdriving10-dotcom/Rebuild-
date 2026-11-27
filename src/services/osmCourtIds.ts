/** App Court.id form produced by Overpass / DB mapper, e.g. osm-node-123. */
const OSM_COURT_ID_RE = /^osm-(node|way)-(\d+)$/;

export type OsmCourtIdentity = { type: 'node' | 'way'; id: number };

/**
 * Parse an app Court.id back to an OSM identity for the ingest Edge Function.
 * Returns null for fallback/manual/malformed ids — never invents identities.
 */
export function parseOsmCourtId(courtId: string): OsmCourtIdentity | null {
  if (typeof courtId !== 'string') return null;
  const match = OSM_COURT_ID_RE.exec(courtId.trim());
  if (!match) return null;
  const id = Number(match[2]);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { type: match[1] as 'node' | 'way', id };
}

/** Cap matches the Edge Function MAX_OSM_IDS_PER_REQUEST. */
export const DISCOVERED_COURT_ID_CAP = 40;

/**
 * Every new OSM node/way identity in discovery order.
 * Skips ids already present in `alreadyKnownIds` (typically verified DB pins).
 * Does not cap — callers chunk with `chunkIdentities` before the Edge Function.
 */
export function listOsmIdentitiesForIngest(
  discoveredCourtIds: string[],
  alreadyKnownIds?: Iterable<string>
): OsmCourtIdentity[] {
  const known = new Set(alreadyKnownIds ?? []);
  const seen = new Set<string>();
  const out: OsmCourtIdentity[] = [];

  for (const courtId of discoveredCourtIds) {
    if (known.has(courtId)) continue;
    const parsed = parseOsmCourtId(courtId);
    if (!parsed) continue;
    const key = `${parsed.type}/${parsed.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }

  return out;
}

/**
 * First page of `listOsmIdentitiesForIngest`, capped for one Edge Function call.
 * Prefer `listOsmIdentitiesForIngest` + `chunkIdentities` when a viewport has more.
 */
export function osmIdentitiesForIngest(
  discoveredCourtIds: string[],
  alreadyKnownIds?: Iterable<string>
): OsmCourtIdentity[] {
  return listOsmIdentitiesForIngest(discoveredCourtIds, alreadyKnownIds).slice(
    0,
    DISCOVERED_COURT_ID_CAP
  );
}

/** Split identities into Edge Function batches. The server rejects more than the cap. */
export function chunkIdentities<T>(items: T[], size: number = DISCOVERED_COURT_ID_CAP): T[][] {
  if (size < 1) return items.length > 0 ? [items] : [];
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
