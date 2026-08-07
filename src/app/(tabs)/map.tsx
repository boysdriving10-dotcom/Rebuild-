import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CourtDetailContent } from '@/components/CourtDetailContent';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useGames } from '@/context/GamesContext';
import { DEFAULT_REGION } from '@/data/mock';
import { filterCourtsByQuery } from '@/data/overpassCourts';
import { useMapCourts } from '@/hooks/useMapCourts';
import type { Court, Game } from '@/types';

type LocationStatus = 'pending' | 'granted' | 'denied';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const { user } = useAuth();
  const { getGamesForCourt, joinGame } = useGames();
  const [query, setQuery] = useState('');
  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('pending');
  const [userCoord, setUserCoord] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [mapReady, setMapReady] = useState(false);
  const didCenterOnUser = useRef(false);

  const {
    courts,
    loading,
    zoomedOut,
    onRegionChangeComplete,
  } = useMapCourts(DEFAULT_REGION);

  const visibleCourts = useMemo(() => filterCourtsByQuery(courts, query), [courts, query]);
  const courtGames = selectedCourt ? getGamesForCourt(selectedCourt.id) : [];

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;

        if (status !== 'granted') {
          setLocationStatus('denied');
          return;
        }

        setLocationStatus('granted');
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (cancelled) return;

        const coord = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setUserCoord(coord);
      } catch {
        if (!cancelled) setLocationStatus('denied');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Center on user; Overpass loads via onRegionChangeComplete (prototype-style).
  useEffect(() => {
    if (!mapReady || !userCoord || didCenterOnUser.current) return;
    didCenterOnUser.current = true;
    const region: Region = {
      latitude: userCoord.latitude,
      longitude: userCoord.longitude,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
    mapRef.current?.animateToRegion(region, 450);
    onRegionChangeComplete(region);
  }, [mapReady, userCoord, onRegionChangeComplete]);

  // Location denied: still search the default visible region once.
  useEffect(() => {
    if (locationStatus !== 'denied') return;
    if (didCenterOnUser.current) return;
    didCenterOnUser.current = true;
    onRegionChangeComplete(DEFAULT_REGION);
  }, [locationStatus, onRegionChangeComplete]);

  const recenter = useCallback(() => {
    if (!userCoord) return;
    const region: Region = {
      latitude: userCoord.latitude,
      longitude: userCoord.longitude,
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
    mapRef.current?.animateToRegion(region, 400);
    onRegionChangeComplete(region);
  }, [userCoord, onRegionChangeComplete]);

  const focusCourt = (court: Court) => {
    setSelectedCourt(court);
    mapRef.current?.animateToRegion(
      {
        latitude: court.latitude,
        longitude: court.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      350
    );
  };

  const goCreate = (court?: Court) => {
    setSelectedCourt(null);
    if (!court) {
      router.push('/(tabs)/create');
      return;
    }
    router.push({
      pathname: '/(tabs)/create',
      params: {
        courtId: court.id,
        courtName: court.name,
        latitude: String(court.latitude),
        longitude: String(court.longitude),
        address: court.address,
      },
    });
  };

  const handleJoinGame = (game: Game) => {
    if (!user) return;
    const result = joinGame(game.id, user.id);
    if (!result.ok) {
      Alert.alert('Couldn’t join', result.error);
      return;
    }
    setSelectedCourt(null);
    Alert.alert('Joined Game', `You're in for ${game.courtName} at ${game.time}.`);
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={DEFAULT_REGION}
        showsUserLocation={locationStatus === 'granted'}
        showsMyLocationButton={false}
        showsCompass={false}
        scrollEnabled
        zoomEnabled
        rotateEnabled
        pitchEnabled
        userInterfaceStyle="dark"
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={(region) => onRegionChangeComplete(region)}>
        {visibleCourts.map((court) => {
          const count = getGamesForCourt(court.id).length;
          return (
            <Marker
              key={court.id}
              coordinate={{
                latitude: court.latitude,
                longitude: court.longitude,
              }}
              title={court.name}
              description={
                count > 0
                  ? `${count} active game${count === 1 ? '' : 's'}`
                  : 'No active games'
              }
              pinColor={count > 0 ? Colors.accent : Colors.textMuted}
              tracksViewChanges={false}
              onPress={() => setSelectedCourt(court)}
            />
          );
        })}
      </MapView>

      <View style={[styles.searchWrap, { top: insets.top + Spacing.sm }]}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search courts..."
          placeholderTextColor={Colors.textMuted}
          value={query}
          onChangeText={setQuery}
          selectionColor={Colors.accent}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {query.length > 0 && visibleCourts.length > 0 ? (
          <View style={styles.results}>
            {visibleCourts.slice(0, 5).map((court) => (
              <Pressable
                key={court.id}
                style={styles.resultRow}
                onPress={() => {
                  setQuery(court.name);
                  focusCourt(court);
                }}>
                <Text style={styles.resultName}>{court.name}</Text>
                <Text style={styles.resultMeta}>{court.address}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {locationStatus === 'denied' ? (
        <View style={[styles.banner, { top: insets.top + 64 }]}>
          <Text style={styles.bannerText}>
            Location is off. You can still browse the map — enable location to jump to courts near
            you.
          </Text>
        </View>
      ) : null}

      {zoomedOut ? (
        <View style={styles.hintBar}>
          <Text style={styles.hintText}>Zoom in to load basketball courts</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingPill} pointerEvents="none">
          <ActivityIndicator color={Colors.accent} size="small" />
          <Text style={styles.loadingText}>Finding courts…</Text>
        </View>
      ) : null}

      {locationStatus === 'granted' && userCoord ? (
        <Pressable
          accessibilityLabel="Recenter on my location"
          onPress={recenter}
          style={[styles.recenter, { bottom: Math.max(insets.bottom, Spacing.lg) + Spacing.lg }]}>
          <Text style={styles.recenterIcon}>◎</Text>
        </Pressable>
      ) : null}

      <BottomSheet visible={selectedCourt !== null} onClose={() => setSelectedCourt(null)}>
        {selectedCourt ? (
          <CourtDetailContent
            court={selectedCourt}
            games={courtGames}
            currentUserId={user?.id}
            onJoinGame={handleJoinGame}
            onStartGame={() => goCreate(selectedCourt)}
            onStartAnother={() => goCreate(selectedCourt)}
          />
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  searchWrap: {
    left: Spacing.lg,
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 10,
  },
  searchInput: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    borderWidth: 1,
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '500',
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  results: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginTop: Spacing.sm,
    overflow: 'hidden',
  },
  resultRow: {
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  resultName: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  resultMeta: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
  },
  banner: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    borderWidth: 1,
    left: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 9,
  },
  bannerText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '500',
    lineHeight: 18,
  },
  hintBar: {
    alignSelf: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    borderWidth: 1,
    bottom: 120,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    position: 'absolute',
    zIndex: 8,
  },
  hintText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  loadingPill: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    borderWidth: 1,
    bottom: 120,
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    position: 'absolute',
    zIndex: 8,
  },
  loadingText: {
    color: Colors.text,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  recenter: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    position: 'absolute',
    right: Spacing.lg,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
    width: 48,
    zIndex: 10,
  },
  recenterIcon: {
    color: Colors.accent,
    fontSize: 22,
    fontWeight: '700',
  },
});
