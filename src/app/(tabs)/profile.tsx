import { StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useGames } from '@/context/GamesContext';

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const { countHosted, countJoined } = useGames();

  if (!user) {
    return null;
  }

  const hosted = countHosted(user.id);
  const joined = countJoined(user.id);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.identity}>
          <Avatar initials={user.avatarInitials} size={104} />
          <Text style={styles.username}>@{user.username}</Text>
          <Text style={styles.bio}>{user.bio || 'Ready to ball.'}</Text>
        </View>

        <View style={styles.stats}>
          <Stat label="Games Hosted" value={hosted} />
          <View style={styles.statDivider} />
          <Stat label="Games Joined" value={joined} />
        </View>

        <Button title="Log Out" variant="outline" onPress={logout} style={styles.logout} />
      </View>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing['3xl'],
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing['5xl'],
  },
  identity: {
    alignItems: 'center',
    gap: Spacing.md,
  },
  username: {
    color: Colors.text,
    fontSize: FontSize['2xl'],
    fontWeight: '800',
  },
  bio: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
    fontWeight: '500',
    textAlign: 'center',
  },
  stats: {
    backgroundColor: Colors.surfaceElevated,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
    width: '100%',
  },
  stat: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.xs,
    paddingVertical: Spacing['2xl'],
  },
  statDivider: {
    backgroundColor: Colors.border,
    width: StyleSheet.hairlineWidth,
  },
  statValue: {
    color: Colors.accent,
    fontSize: FontSize['2xl'],
    fontWeight: '800',
  },
  statLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  logout: {
    marginTop: Spacing.md,
    width: '100%',
  },
});
