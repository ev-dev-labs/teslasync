import React, {type ReactNode} from 'react';
import {View, type ViewProps} from 'react-native';

export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface SafeAreaProviderProps {
  children: ReactNode;
}

export function SafeAreaProvider({children}: SafeAreaProviderProps) {
  return <View style={{flex: 1}}>{children}</View>;
}

export function SafeAreaView({children, style, ...props}: ViewProps) {
  return (
    <View {...props} style={[{flex: 1}, style]}>
      {children}
    </View>
  );
}

export function useSafeAreaInsets(): EdgeInsets {
  return {top: 0, right: 0, bottom: 0, left: 0};
}

export const initialWindowMetrics = {
  frame: {x: 0, y: 0, width: 0, height: 0},
  insets: {top: 0, right: 0, bottom: 0, left: 0},
};
