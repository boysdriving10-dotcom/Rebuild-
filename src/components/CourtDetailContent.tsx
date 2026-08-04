import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Colors, FontSize, Spacing } from '@/constants/theme';
import type { Court } from '@/types';

type CourtDetailSheetProps = {
  court: Court;
  activeGameCount: number;
  onJoinGame: () => void;
  onStartGame: () => void;
  onStartAnother: () => void;
};

export function CourtDetailContent({
  court,
  activeGameCount,
  onJoinGame,
  onStartGame,
  onStartAnother,
}: CourtDetailSheetProps) {
  const hasGames = activeGameCount > 0;

  const openDirections = async () => {
    const label = encodeURIComponent(court.name);
    const { latitude, longitude } = court;
    const url = Platform.select({
      ios: `maps:0,0?q=${label}@${latitude},${longitude}`,
      android: `geo:0,0?q=${latitude},${longitude}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    });
    if (url) {
      await Linking.openURL(url);
    }
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
            <Button title="Join Game" onPress={onJoinGame} />
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
