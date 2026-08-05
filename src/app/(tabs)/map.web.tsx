import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CourtDetailContent } from '@/components/CourtDetailContent';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useGames } from '@/context/GamesContext';
import { searchCourts } from '@/data/mock';
import type { Court, Game } from '@/types';

/** Web fallback — interactive maps ship on iOS/Android */
export default function MapScreenWeb() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { getGamesForCourt, joinGame } = useGames();
  const [query, setQuery] = useState('');
  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null);
  const courts = useMemo(() => searchCourts(query), [query]);
  const courtGames = selectedCourt ? getGamesForCourt(selectedCourt.id) : [];

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
    <View style={[styles.root, { paddingTop: insets.top + Spacing.md }]}>
      <Text style={styles.title}>Courts</Text>
      <Text style={styles.hint}>
        Open the iOS or Android app for the full interactive map experience.
      </Text>

      <TextInput
        style={styles.searchInput}
        placeholder="Search courts..."
        placeholderTextColor={Colors.textMuted}
        value={query}
        onChangeText={setQuery}
        selectionColor={Colors.accent}
      />

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {courts.map((court) => {
          const count = getGamesForCourt(court.id).length;
          return (
            <Pressable key={court.id} style={styles.court} onPress={() => setSelectedCourt(court)}>
              <Text style={styles.courtName}>{court.name}</Text>
              <Text style={styles.courtMeta}>
                {count > 0 ? `${count} active games` : 'No active games'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

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
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  title: {
    color: Colors.text,
    fontSize: FontSize['2xl'],
    fontWeight: '800',
  },
  hint: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  searchInput: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    borderWidth: 1,
    color: Colors.text,
    fontSize: FontSize.md,
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
  },
  list: {
    gap: Spacing.sm,
    paddingBottom: Spacing['4xl'],
    paddingTop: Spacing.sm,
  },
  court: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    borderWidth: 1,
    gap: 4,
    padding: Spacing.lg,
  },
  courtName: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  courtMeta: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
});
