import {
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Colors, FontSize, Radius, Spacing } from '@/constants/theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline';
type Size = 'md' | 'lg';

type ButtonProps = PressableProps & {
  title: string;
  variant?: Variant;
  size?: Size;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  title,
  variant = 'primary',
  size = 'lg',
  style,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        size === 'lg' ? styles.lg : styles.md,
        variantStyles[variant],
        pressed && !disabled && pressedStyles[variant],
        disabled && styles.disabled,
        style,
      ]}
      {...props}>
      <Text style={[styles.label, labelStyles[variant], size === 'md' && styles.labelMd]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  lg: {
    minHeight: 54,
    paddingHorizontal: Spacing['2xl'],
  },
  md: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
  },
  label: {
    color: Colors.white,
    fontSize: FontSize.md,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  labelMd: {
    fontSize: FontSize.sm,
  },
  disabled: {
    opacity: 0.45,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: Colors.accent,
  },
  secondary: {
    backgroundColor: Colors.surfaceElevated,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
});

const pressedStyles = StyleSheet.create({
  primary: {
    backgroundColor: Colors.accentPressed,
  },
  secondary: {
    backgroundColor: Colors.surfaceHover,
  },
  ghost: {
    opacity: 0.7,
  },
  outline: {
    backgroundColor: Colors.surface,
  },
});

const labelStyles = StyleSheet.create({
  primary: {
    color: Colors.white,
  },
  secondary: {
    color: Colors.text,
  },
  ghost: {
    color: Colors.accent,
  },
  outline: {
    color: Colors.text,
  },
});
