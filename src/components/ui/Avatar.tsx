import { StyleSheet, Text, View } from 'react-native';

import { Colors, FontSize } from '@/constants/theme';

type AvatarProps = {
  initials: string;
  size?: number;
};

export function Avatar({ initials, size = 96 }: AvatarProps) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}>
      <Text style={[styles.initials, { fontSize: size * 0.32 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: Colors.accentSoft,
    borderColor: Colors.accent,
    borderWidth: 2,
    justifyContent: 'center',
  },
  initials: {
    color: Colors.accent,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
