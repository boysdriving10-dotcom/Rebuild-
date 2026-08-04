import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CourtDetailContent } from '@/components/CourtDetailContent';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { DEFAULT_REGION, getGamesForCourt, searchCourts } from '@/data/mock';
import type { Court } from '@/types';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [query, setQuery] = useState('');
  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null);
  const [region] = useState<Region>(DEFAULT_REGION);

  const courts = useMemo(() => searchCourts(query), [query]);
  const activeGameCount = selectedCourt ? getGamesForCourt(selectedCourt.id).length : 0;

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

  const goCreate = (courtId?: string) => {
    setSelectedCourt(null);
    router.push({
      pathname: '/(tabs)/create',
      params: courtId ? { courtId } : undefined,
    });
  };

  const joinGame = () => {
    setSelectedCourt(null);
    Alert.alert('Join Game', 'Opening game details (mock). Head to Home to see all games.');
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        userInterfaceStyle="dark">
        {courts.map((court) => {
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
        {query.length > 0 && courts.length > 0 ? (
          <View style={styles.results}>
            {courts.slice(0, 5).map((court) => (
              <Pressable
                key={court.id}
                style={styles.resultRow}
                onPress={() => {
                  setQuery(court.name);
                  focusCourt(court);
                }}>
                <Text style={styles.resultName}>{court.name}</Text>
                <Text style={styles.resultMeta}>
                  {getGamesForCourt(court.id).length > 0
                    ? `${getGamesForCourt(court.id).length} games`
                    : 'No games'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      <BottomSheet visible={selectedCourt !== null} onClose={() => setSelectedCourt(null)}>
        {selectedCourt ? (
          <CourtDetailContent
            court={selectedCourt}
            activeGameCount={activeGameCount}
            onJoinGame={joinGame}
            onStartGame={() => goCreate(selectedCourt.id)}
            onStartAnother={() => goCreate(selectedCourt.id)}
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
});
