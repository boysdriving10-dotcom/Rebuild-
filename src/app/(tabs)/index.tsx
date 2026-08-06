import { useMemo } from 'react';
import { Alert, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

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

  const myGames = useMemo(() => {
    if (!user) return [];
    return games.filter(
      (g) => g.hostId === user.id || g.playerIds.includes(user.id)
    );
  }, [games, user]);

  const nearbyGames = useMemo(() => {
    if (!user) return games;
    const myIds = new Set(myGames.map((g) => g.id));
    return games.filter((g) => !myIds.has(g.id));
  }, [games, myGames, user]);

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

  const handleViewCourt = (game: Game) => {
    router.push({
      pathname: '/(tabs)/map',
      params: {
        focusCourtId: game.courtId,
        focusName: game.courtName,
        focusAddress: game.courtAddress,
        focusLatitude: String(game.courtLatitude),
        focusLongitude: String(game.courtLongitude),
      },
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
      </View>

      <FlatList
        data={nearbyGames}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.sections}>
            <Text style={styles.sectionTitle}>My Games</Text>
            {myGames.length === 0 ? (
              <Text style={styles.emptyInline}>No active games yet.</Text>
            ) : (
              myGames.map((game) => (
                <View key={game.id} style={styles.cardWrap}>
                  <GameCard
                    game={game}
                    mode="mine"
                    joined={user ? isJoined(game.id, user.id) : false}
                    onJoin={handleJoin}
                    onLeave={handleLeave}
                    onDirections={handleDirections}
                    onViewCourt={handleViewCourt}
                  />
                </View>
              ))
            )}
            <Text style={[styles.sectionTitle, styles.nearbyTitle]}>Nearby Games</Text>
          </View>
        }
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
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
  },
  logo: {
    borderRadius: Radius.sm,
    height: 36,
    width: 36,
  },
  list: {
    paddingBottom: BottomTabInset + Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  sections: {
    paddingBottom: Spacing.md,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: Spacing.md,
  },
  nearbyTitle: {
    marginTop: Spacing.xl,
  },
  emptyInline: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '500',
    marginBottom: Spacing.sm,
  },
  cardWrap: {
    marginBottom: Spacing.md,
  },
  separator: {
    height: Spacing.md,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.lg,
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
