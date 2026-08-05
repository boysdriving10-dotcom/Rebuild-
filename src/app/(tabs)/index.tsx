import { Alert, FlatList, Image, StyleSheet, Text, View } from 'react-native';

import { GameCard } from '@/components/ui/GameCard';
import { Screen } from '@/components/ui/Screen';
import { BottomTabInset, Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useGames } from '@/context/GamesContext';
import type { Game } from '@/types';
import { openCourtDirections } from '@/utils/openDirections';

const logo = require('../../../assets/images/ballout-logo.png');

export default function HomeScreen() {
  const { user } = useAuth();
  const { games, joinGame, leaveGame, isJoined } = useGames();

  const handleJoin = (game: Game) => {
    if (!user) return;
    const result = joinGame(game.id, user.id);
    if (!result.ok) {
      Alert.alert('Couldn’t join', result.error);
      return;
    }
    Alert.alert('Joined Game', `You're in for ${game.courtName} at ${game.time}.`);
  };

  const handleLeave = (game: Game) => {
    if (!user) return;
    const result = leaveGame(game.id, user.id);
    if (!result.ok) {
      Alert.alert('Couldn’t leave', result.error);
    }
  };

  const handleDirections = (game: Game) => {
    void openCourtDirections({
      latitude: game.courtLatitude,
      longitude: game.courtLongitude,
      name: game.courtName,
      address: game.courtAddress,
    });
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Image
          source={logo}
          style={styles.logo}
          accessibilityLabel="BallOut"
          resizeMode="contain"
        />
        <Text style={styles.subtitle}>Nearby pickup games</Text>
      </View>

      <FlatList
        data={games}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <GameCard
            game={item}
            joined={user ? isJoined(item.id, user.id) : false}
            onJoin={handleJoin}
            onLeave={handleLeave}
            onDirections={handleDirections}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No games nearby</Text>
            <Text style={styles.emptyBody}>Check Courts or create a game.</Text>
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
  logo: {
    borderRadius: Radius.sm,
    height: 36,
    width: 36,
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
