import React, { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { colors } from '../../theme/tokens';

interface GlassPanelProps {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
}

export function GlassPanel({children, style}: GlassPanelProps) {
  return <View style={[styles.root, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surfaceGlass,
  },
});
