import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import type { Game } from '@/types';
import { formatGameDateLabel } from '@/utils/gameDate';

type GameCardProps = {
  game: Game;
  joined: boolean;
  onJoin: (game: Game) => void;
  onLeave: (game: Game) => void;
  onDirections: (game: Game) => void;
  /** Shown only for the host. */
  onCancel?: (game: Game) => void;
  cancelling?: boolean;
  /** When set, shows a View Court action (used by My Games). */
  onViewCourt?: (game: Game) => void;
  /** My Games layout: Directions, View Court, Leave — no Join. */
  mode?: 'nearby' | 'mine';
};

export function GameCard({
  game,
  joined,
  onJoin,
  onLeave,
  onDirections,
  onCancel,
  cancelling = false,
  onViewCourt,
  mode = 'nearby',
}: GameCardProps) {
  const spotsLeft = game.maxPlayers - game.currentPlayers;
  const full = spotsLeft <= 0;
  const dateLabel = formatGameDateLabel(game.date);

  return (
    <View style={styles.card}>
      <View style={styles.titleBlock}>
        <Text style={styles.courtName} numberOfLines={1}>
          {game.courtName}
        </Text>
        {!!game.courtAddress && (
          <Text style={styles.courtAddress} numberOfLines={2}>
            {game.courtAddress}
          </Text>
        )}
        <Text style={styles.schedule}>
          {dateLabel} • {game.time}
        </Text>
        <Text style={[styles.players, spotsLeft <= 2 && !full && styles.playersHot]}>
          {game.currentPlayers}/{game.maxPlayers} players
        </Text>
      </View>

      {mode === 'mine' ? (
        <View style={styles.actions}>
          <Button title="Get Directions" variant="outline" onPress={() => onDirections(game)} />
          {onViewCourt ? (
            <Button title="View Court" variant="secondary" onPress={() => onViewCourt(game)} />
          ) : null}
          {onCancel ? (
            <Button
              title={cancelling ? 'Cancelling…' : 'Cancel Game'}
              variant="secondary"
              disabled={cancelling}
              onPress={() => onCancel(game)}
            />
          ) : null}
          {joined ? (
            <Button title="Leave Game" variant="secondary" onPress={() => onLeave(game)} />
          ) : null}
        </View>
      ) : joined ? (
        <View style={styles.actions}>
          <Button title="Leave Game" variant="secondary" onPress={() => onLeave(game)} />
          <Button title="Get Directions" variant="outline" onPress={() => onDirections(game)} />
        </View>
      ) : (
        <Button
          title={full ? 'Game Full' : 'Join Game'}
          disabled={full}
          onPress={() => onJoin(game)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.lg,
    padding: Spacing.lg,
  },
  titleBlock: {
    gap: 4,
  },
  courtName: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  courtAddress: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  schedule: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
    marginTop: 4,
  },
  players: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  playersHot: {
    color: Colors.accent,
  },
  actions: {
    gap: Spacing.sm,
  },
});
