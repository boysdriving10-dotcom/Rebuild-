import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';

type Option<T extends string> = {
  label: string;
  value: T;
};

type SegmentedControlProps<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.item, selected && styles.itemSelected]}>
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    flexDirection: 'row',
    gap: Spacing.xs,
    padding: Spacing.xs,
  },
  item: {
    alignItems: 'center',
    borderRadius: Radius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: Spacing.sm,
  },
  itemSelected: {
    backgroundColor: Colors.accent,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    fontWeight: '600',
  },
  labelSelected: {
    color: Colors.white,
  },
});
