import { StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';

type ScreenProps = ViewProps & {
  /** Extra bottom padding for tab bar screens */
  paddedBottom?: boolean;
  edges?: ('top' | 'bottom')[];
};

export function Screen({
  children,
  style,
  paddedBottom = false,
  edges = ['top'],
  ...props
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.screen,
        {
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom')
            ? insets.bottom + (paddedBottom ? Spacing['2xl'] : 0)
            : paddedBottom
              ? Spacing['2xl']
              : 0,
        },
        style,
      ]}
      {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Colors.background,
    flex: 1,
  },
});
