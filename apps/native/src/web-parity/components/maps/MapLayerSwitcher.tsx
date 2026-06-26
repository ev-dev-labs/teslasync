// Native parity port of web/src/components/maps/MapLayerSwitcher.tsx.
//
// The web original is a floating Leaflet overlay control. React Native has no
// Leaflet/DOM map container, so this port renders the same four tile-style
// toggles (dark, satellite, streets, terrain) as an absolutely positioned
// row of Pressable chips that a native map host can overlay. Behavior,
// prop names (current/onChange), the MapStyle union, the layer icon+label
// table, and the responsive icon-only-on-narrow-screens intent are preserved.

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import {colors, spacing} from '../../../theme/tokens';

// The web component imports this union from ./MapTileLayer. That sibling is
// not yet ported to native, so the canonical union is defined and re-exported
// here so native callers stay in sync with the web contract.
export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain';

interface MapLayerSwitcherProps {
  current: MapStyle;
  onChange: (style: MapStyle) => void;
}

const layers: {id: MapStyle; icon: string; label: string}[] = [
  {id: 'dark', icon: '🌑', label: 'Dark'},
  {id: 'satellite', icon: '🛰️', label: 'Satellite'},
  {id: 'streets', icon: '🗺️', label: 'Streets'},
  {id: 'terrain', icon: '⛰️', label: 'Terrain'},
];

// Tailwind's `sm:` breakpoint (640px). Below this the web label is hidden via
// `hidden sm:inline`; the icon-only chip is shown on narrow viewports.
const SM_BREAKPOINT = 640;

export function MapLayerSwitcher({current, onChange}: MapLayerSwitcherProps) {
  const {width} = useWindowDimensions();
  const showLabel = width >= SM_BREAKPOINT;

  return (
    <View style={styles.container}>
      {layers.map(l => {
        const active = current === l.id;
        return (
          <Pressable
            key={l.id}
            accessibilityLabel={l.label}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(l.id)}
            style={({pressed}) => [
              styles.button,
              active ? styles.buttonActive : styles.buttonInactive,
              pressed && !active && styles.buttonPressed,
            ]}>
            <Text style={styles.icon}>{l.icon}</Text>
            {showLabel ? (
              <Text
                style={[
                  styles.label,
                  active ? styles.labelActive : styles.labelInactive,
                ]}>
                {l.label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: spacing.lg + spacing.xs,
    left: spacing.sm,
    zIndex: 1000,
    flexDirection: 'row',
    gap: spacing.xs,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    padding: spacing.xs,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: {width: 0, height: 8},
    elevation: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  buttonActive: {
    backgroundColor: colors.surfaceRaised,
  },
  buttonInactive: {
    backgroundColor: 'transparent',
  },
  buttonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  icon: {
    fontSize: 11,
    lineHeight: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 16,
  },
  labelActive: {
    color: colors.textPrimary,
  },
  labelInactive: {
    color: colors.textSecondary,
  },
});
