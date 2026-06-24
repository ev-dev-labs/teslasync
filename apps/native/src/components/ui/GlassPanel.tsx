import React, { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { colors } from '../../theme/tokens';

interface GlassPanelProps extends ViewProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function GlassPanel({children, style, ...props}: GlassPanelProps) {
  return (
    <View {...props} style={[styles.root, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surfaceGlass,
  },
});
