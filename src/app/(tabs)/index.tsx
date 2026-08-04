import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { GameCard } from '@/components/ui/GameCard';
import { Screen } from '@/components/ui/Screen';
import { BottomTabInset, Colors, FontSize, Spacing } from '@/constants/theme';
import { MOCK_GAMES } from '@/data/mock';
import type { Game } from '@/types';

export default function HomeScreen() {
  const [games] = useState(MOCK_GAMES);

  const handleJoin = (game: Game) => {
    Alert.alert(
      'Joined Game',
      `You're in for ${game.courtName} at ${game.time}. (Mock — backend coming soon.)`,
      [{ text: 'OK' }]
    );
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.brand}>BallOut</Text>
        <Text style={styles.subtitle}>Nearby pickup games</Text>
      </View>

      <FlatList
        data={games}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => <GameCard game={item} onJoin={handleJoin} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No games nearby</Text>
            <Text style={styles.emptyBody}>Check the Map or create a game.</Text>
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: Spacing.xs,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
  },
  brand: {
    color: Colors.accent,
    fontSize: FontSize['2xl'],
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '500',
  },
  list: {
    paddingBottom: BottomTabInset + Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  separator: {
    height: Spacing.md,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing['5xl'],
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  emptyBody: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
});
