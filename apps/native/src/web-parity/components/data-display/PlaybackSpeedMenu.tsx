// Native parity port of web/src/components/data-display/PlaybackSpeedMenu.tsx.
// The web control is a ghost <Button> whose left-click cycles to the next speed
// and whose right-click (onContextMenu) steps one slot slower. React Native has
// no right-click/context-menu gesture, so the backward step is mapped to a
// long-press (the idiomatic touch equivalent), preserving the bidirectional
// scrub-speed behavior. The lucide ChevronDown affordance becomes a muted text
// caret, and react-i18next is replaced by a native English-default fallback
// (the parity layer has no i18next provider). Documented in the parity sidecar.

import React from 'react';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/**
 * Web sources this from `@/hooks/useTripReplay`; that hook is not part of the
 * native parity layer, so the literal-union type is mirrored locally here.
 */
export type ReplaySpeed = 1 | 10 | 25 | 50 | 100;

/** Native parity has no react-i18next provider; return the English default. */
function t(_key: string, fallback: string): string {
  return fallback;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const REPLAY_SPEEDS: ReplaySpeed[] = [1, 10, 25, 50, 100];

/** Step the speed up by `delta` slots (signed). */
export function shiftSpeed(current: ReplaySpeed, delta: number): ReplaySpeed {
  const idx = REPLAY_SPEEDS.indexOf(current);
  const safeIdx = idx === -1 ? 0 : idx;
  const nextIdx = Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, safeIdx + delta));
  return REPLAY_SPEEDS[nextIdx];
}

/** Cycle to the next-fastest speed (wraps around). */
export function nextSpeed(current: ReplaySpeed): ReplaySpeed {
  const idx = REPLAY_SPEEDS.indexOf(current);
  return REPLAY_SPEEDS[(idx + 1) % REPLAY_SPEEDS.length];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface PlaybackSpeedMenuProps {
  speed: ReplaySpeed;
  onChange: (speed: ReplaySpeed) => void;
  /** Accepted for web source parity; React Native has no CSS class names. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * Compact playback-speed control. Tap cycles to the next speed; long-press
 * cycles backwards (the native stand-in for the web right-click). Used by
 * `<PlaybackControls>` and any other surface that exposes scrub-speed selection.
 */
export function PlaybackSpeedMenu({
  speed,
  onChange,
  className: _className,
  style,
  testID,
  accessibilityLabel,
}: PlaybackSpeedMenuProps) {
  const label = accessibilityLabel ?? t('replay.controls.speed', 'Playback speed');

  return (
    <Pressable
      accessible
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityValue={{text: `${speed}x`}}
      hitSlop={8}
      onLongPress={() => onChange(shiftSpeed(speed, -1))}
      onPress={() => onChange(nextSpeed(speed))}
      style={({pressed}) => [styles.root, pressed && styles.pressed, style]}
      testID={testID ?? 'playback-speed-menu'}>
      <AppText numberOfLines={1} style={styles.value} variant="caption">
        {speed}x
      </AppText>
      <AppText numberOfLines={1} style={styles.caret} variant="caption">
        {'\u25BE'}
      </AppText>
    </Pressable>
  );
}

PlaybackSpeedMenu.displayName = 'PlaybackSpeedMenu';

const styles = StyleSheet.create({
  caret: {
    color: colors.textPrimary,
    marginLeft: 2,
    opacity: 0.5,
  },
  pressed: {
    backgroundColor: colors.surfaceHover,
  },
  root: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  value: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
});
