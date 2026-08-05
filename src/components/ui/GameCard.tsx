import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import type { Game } from '@/types';

type GameCardProps = {
  game: Game;
  joined: boolean;
  onJoin: (game: Game) => void;
  onLeave: (game: Game) => void;
  onDirections: (game: Game) => void;
};

export function GameCard({ game, joined, onJoin, onLeave, onDirections }: GameCardProps) {
  const spotsLeft = game.maxPlayers - game.currentPlayers;
  const full = spotsLeft <= 0;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.titleBlock}>
          <Text style={styles.courtName} numberOfLines={1}>
            {game.courtName}
          </Text>
          <Text style={styles.distance}>{game.distance || 'Nearby'}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{game.date}</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <MetaChip label="Time" value={game.time} />
        <MetaChip
          label="Players"
          value={`${game.currentPlayers}/${game.maxPlayers}`}
          highlight={spotsLeft <= 2 && !full}
        />
      </View>

      {joined ? (
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

function MetaChip({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={[styles.chipValue, highlight && styles.chipValueHot]}>{value}</Text>
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
  top: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.md,
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    gap: 4,
  },
  courtName: {
    color: Colors.text,
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  distance: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '500',
  },
  badge: {
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  badgeText: {
    color: Colors.accent,
    fontSize: FontSize.xs,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  chip: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    flex: 1,
    gap: 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  chipLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  chipValue: {
    color: Colors.text,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  chipValueHot: {
    color: Colors.accent,
  },
  actions: {
    gap: Spacing.sm,
  },
});
