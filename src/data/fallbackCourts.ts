import type { BBox } from '@/data/overpassCourts';
import type { Court } from '@/types';

/**
 * Verified South Jersey courts used when Overpass fails or returns nothing
 * useful for the visible bbox. Keep names/coords aligned with park records.
 */
export const FALLBACK_COURTS: Court[] = [
  {
    // Monroe Twp: Owens Park.
    // Coords: OSM leisure=pitch/sport=basketball way/667347315.
    id: 'fallback-owens-park',
    name: 'Owens Park Basketball Court',
    latitude: 39.678688,
    longitude: -75.01237,
    address: '690 N Tuckahoe Rd, Williamstown, NJ 08094',
    activeGameIds: [],
  },
  {
    // Monroe Twp: Church Street Complex (4 basketball courts).
    // Coords: OSM leisure=pitch/sport=basketball way/741672531 near 408 Church St.
    id: 'fallback-church-street-complex',
    name: 'Church Street Complex Basketball Courts',
    latitude: 39.68155,
    longitude: -74.996494,
    address: '408 Church St, Williamstown, NJ 08094',
    activeGameIds: [],
  },
  {
    // Winslow Twp: Peter Volpa Memorial Park (3 basketball courts).
    // Coords: Nominatim geocode of 569 Sickler Ave (no OSM basketball pitch on-site).
    id: 'fallback-peter-volpa',
    name: 'Peter Volpa Memorial Park Basketball Courts',
    latitude: 39.725961,
    longitude: -74.977744,
    address: '569 Sickler Ave, Sicklerville, NJ 08081',
    activeGameIds: [],
  },
  {
    // Winslow Twp: Carmelo Felix Memorial Park.
    // Coords: OSM leisure=pitch/sport=basketball way/598145016 on Pinewood Lane.
    id: 'fallback-carmelo-felix',
    name: 'Carmelo Felix Memorial Park Basketball Court',
    latitude: 39.709194,
    longitude: -74.961387,
    address: 'Pinewood Lane, Sicklerville, NJ 08081',
    activeGameIds: [],
  },
];

function isCourtInBBox(court: Court, bbox: BBox): boolean {
  return (
    court.latitude >= bbox.south &&
    court.latitude <= bbox.north &&
    court.longitude >= bbox.west &&
    court.longitude <= bbox.east
  );
}

/** Fallback courts that fall inside the visible map bounds. */
export function getFallbackCourtsInBBox(bbox: BBox): Court[] {
  return FALLBACK_COURTS.filter((court) => isCourtInBBox(court, bbox));
}
