import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CourtDetailContent } from '@/components/CourtDetailContent';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { getGamesForCourt, searchCourts } from '@/data/mock';
import type { Court } from '@/types';

/** Web fallback — interactive maps ship on iOS/Android */
export default function MapScreenWeb() {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selectedCourt, setSelectedCourt] = useState<Court | null>(null);
  const courts = useMemo(() => searchCourts(query), [query]);
  const activeGameCount = selectedCourt ? getGamesForCourt(selectedCourt.id).length : 0;

  const goCreate = (courtId?: string) => {
    setSelectedCourt(null);
    router.push({
      pathname: '/(tabs)/create',
      params: courtId ? { courtId } : undefined,
    });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.md }]}>
      <Text style={styles.title}>Map</Text>
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
            activeGameCount={activeGameCount}
            onJoinGame={() => {
              setSelectedCourt(null);
              Alert.alert('Join Game', 'Mock join — backend coming soon.');
            }}
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
