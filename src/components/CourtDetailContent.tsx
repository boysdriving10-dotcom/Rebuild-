import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Colors, FontSize, Spacing } from '@/constants/theme';
import type { Court, Game } from '@/types';
import { openCourtDirections } from '@/utils/openDirections';

type CourtDetailSheetProps = {
  court: Court;
  games: Game[];
  currentUserId?: string;
  onJoinGame: (game: Game) => void;
  onStartGame: () => void;
  onStartAnother: () => void;
};

export function CourtDetailContent({
  court,
  games,
  currentUserId,
  onJoinGame,
  onStartGame,
  onStartAnother,
}: CourtDetailSheetProps) {
  const activeGameCount = games.length;
  const hasGames = activeGameCount > 0;

  const joinable = games.find(
    (g) =>
      g.currentPlayers < g.maxPlayers &&
      (!currentUserId || !g.playerIds.includes(currentUserId))
  );

  const openDirections = () => {
    void openCourtDirections({
      latitude: court.latitude,
      longitude: court.longitude,
      name: court.name,
      address: court.address,
    });
  };

  const handleJoin = () => {
    if (!joinable) {
      Alert.alert('No open games', 'Every game here is full or you already joined.');
      return;
    }
    onJoinGame(joinable);
  };

  return (
    <View style={styles.content}>
      <View style={styles.header}>
        <Text style={styles.pin}>📍</Text>
        <View style={styles.headerText}>
          <Text style={styles.name}>{court.name}</Text>
          <Text style={styles.address} numberOfLines={2}>
            {court.address}
          </Text>
        </View>
      </View>

      <Text style={styles.status}>
        {hasGames
          ? `${activeGameCount} Active Game${activeGameCount === 1 ? '' : 's'}`
          : 'No Active Games'}
      </Text>

      <View style={styles.actions}>
        {hasGames ? (
          <>
            <Button title="Join Game" onPress={handleJoin} />
            <Button title="Start Another Game" variant="secondary" onPress={onStartAnother} />
          </>
        ) : (
          <Button title="Start Game" onPress={onStartGame} />
        )}
        <Button title="Get Directions" variant="outline" onPress={openDirections} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.lg,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  pin: {
    fontSize: 22,
    lineHeight: 28,
    marginTop: 2,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  name: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
  },
  address: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 18,
  },
  status: {
    color: Colors.accent,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  actions: {
    gap: Spacing.sm,
  },
});
