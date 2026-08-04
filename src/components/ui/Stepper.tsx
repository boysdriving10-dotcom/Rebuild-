import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';

type StepperProps = {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
};

export function Stepper({ value, min = 2, max = 20, onChange }: StepperProps) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel="Decrease"
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={({ pressed }) => [
          styles.btn,
          pressed && styles.btnPressed,
          value <= min && styles.btnDisabled,
        ]}>
        <Text style={styles.btnText}>−</Text>
      </Pressable>
      <Text style={styles.value}>{value}</Text>
      <Pressable
        accessibilityLabel="Increase"
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={({ pressed }) => [
          styles.btn,
          pressed && styles.btnPressed,
          value >= max && styles.btnDisabled,
        ]}>
        <Text style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.lg,
  },
  btn: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceHover,
    borderRadius: Radius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  btnPressed: {
    backgroundColor: Colors.accent,
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnText: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '600',
    lineHeight: 26,
  },
  value: {
    color: Colors.text,
    fontSize: FontSize.xl,
    fontWeight: '700',
    minWidth: 36,
    textAlign: 'center',
  },
});
