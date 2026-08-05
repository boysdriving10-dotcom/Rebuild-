import { Linking, Platform } from 'react-native';

type DirectionsTarget = {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
};

/** Open Apple Maps (iOS) / maps app with directions to a court. */
export async function openCourtDirections(target: DirectionsTarget): Promise<void> {
  const { latitude, longitude, name, address } = target;
  const hasCoords =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude);

  let url: string | undefined;

  if (hasCoords) {
    url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`,
      android: `google.navigation:q=${latitude},${longitude}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
    });
  } else {
    const query = encodeURIComponent([name, address].filter(Boolean).join(', ') || 'basketball court');
    url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${query}&dirflg=d`,
      android: `geo:0,0?q=${query}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${query}`,
    });
  }

  if (url) {
    await Linking.openURL(url);
  }
}
