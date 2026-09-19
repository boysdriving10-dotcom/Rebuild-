/**
 * Court reverse-geocoding — same Nominatim + in-memory cache approach as the
 * earlier BallOut web app (`client/src/lib/osm-courts.ts` → `reverseGeocode`).
 * Separate from the Overpass courts cache.
 *
 * On React Native, Expo replaces global `fetch` with an OkHttp-backed client.
 * Nominatim returns HTTP 403 for stock `okhttp/*` User-Agents; we send an
 * identifying UA + Referer and fall back to expo-location when Nominatim fails.
 */

import * as Location from 'expo-location';

export type ReverseGeocodeResult = {
  streetName: string | null;
  cityName: string | null;
  fullAddress: string | null;
};

type NominatimAddress = {
  road?: string;
  pedestrian?: string;
  footway?: string;
  street?: string;
  path?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
};

const geocodeCache = new Map<string, ReverseGeocodeResult>();

/** Nominatim blocks stock HTTP-library UAs (e.g. okhttp); identify the app. */
const NOMINATIM_USER_AGENT = 'BalloutBasketball/1.0 (BallOut; reverse-geocode)';
const NOMINATIM_REFERER = 'https://ballout.app/';

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

function isEmptyResult(result: ReverseGeocodeResult): boolean {
  return !result.streetName && !result.cityName;
}

/** Street + city/town for display/search — no house number. */
export function formatResolvedAddress(result: ReverseGeocodeResult): string | null {
  const parts = [result.streetName, result.cityName].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return null;
}

function parseNominatimAddress(
  address: NominatimAddress,
  displayName?: string
): ReverseGeocodeResult {
  // Same street preference order as the original BallOut reverseGeocode.
  const streetName =
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.street ||
    address.path ||
    address.neighbourhood ||
    address.suburb ||
    null;

  // Prefer village/hamlet before town so NJ places resolve as "Sicklerville"
  // rather than only the township name.
  const cityName =
    address.city ||
    address.village ||
    address.hamlet ||
    address.town ||
    null;

  return {
    streetName,
    cityName: cityName && cityName !== streetName ? cityName : null,
    fullAddress: displayName || null,
  };
}

async function reverseGeocodeNominatim(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult | null> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
    {
      // Expo fetch defaults credentials to include; omit for a clean public GET.
      credentials: 'omit',
      headers: {
        Accept: 'application/json',
        'User-Agent': NOMINATIM_USER_AGENT,
        // Policy accepts Referer or User-Agent; send both for mobile clients.
        Referer: NOMINATIM_REFERER,
      },
    }
  );

  if (__DEV__) {
    console.log('[reverseGeocode] Nominatim', {
      lat,
      lon,
      status: response.status,
      ok: response.ok,
    });
  }

  if (!response.ok) {
    console.error('Nominatim API error:', response.status);
    return null;
  }

  const data = (await response.json()) as {
    address?: NominatimAddress;
    display_name?: string;
    error?: string;
  };

  if (data.error || !data.address) {
    if (__DEV__) {
      console.log('[reverseGeocode] Nominatim empty/error body', data.error ?? null);
    }
    return null;
  }

  return parseNominatimAddress(data.address, data.display_name);
}

async function reverseGeocodeNative(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult> {
  const places = await Location.reverseGeocodeAsync({
    latitude: lat,
    longitude: lon,
  });
  const place = places[0];
  if (!place) {
    return { streetName: null, cityName: null, fullAddress: null };
  }

  const streetName = place.street?.trim() || null;
  const cityName =
    place.city?.trim() ||
    place.subregion?.trim() ||
    place.district?.trim() ||
    null;

  const result: ReverseGeocodeResult = {
    streetName,
    cityName: cityName && cityName !== streetName ? cityName : null,
    fullAddress:
      [streetName, cityName, place.region, place.postalCode].filter(Boolean).join(', ') ||
      null,
  };

  if (__DEV__) {
    console.log('[reverseGeocode] native fallback', { lat, lon, result });
  }

  return result;
}

/**
 * Reverse-geocode lat/lon. Results are cached by rounded coordinates.
 * Tries Nominatim first (same as the old BallOut web app); on failure uses
 * expo-location so Android/OkHttp 403s do not leave courts stuck.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<ReverseGeocodeResult> {
  const key = cacheKey(lat, lon);
  const cached = geocodeCache.get(key);
  if (cached) return cached;

  try {
    let result: ReverseGeocodeResult | null = null;

    try {
      result = await reverseGeocodeNominatim(lat, lon);
    } catch (error) {
      console.error('Nominatim reverse geocoding failed:', error);
      result = null;
    }

    if (!result || isEmptyResult(result)) {
      result = await reverseGeocodeNative(lat, lon);
    }

    // Only cache useful results so transient failures can retry.
    if (!isEmptyResult(result)) {
      geocodeCache.set(key, result);
    }
    return result;
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return { streetName: null, cityName: null, fullAddress: null };
  }
}
