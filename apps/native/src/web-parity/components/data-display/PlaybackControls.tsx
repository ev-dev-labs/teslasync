// Native parity port of web/src/components/data-display/PlaybackControls.tsx.
// Playback control bar for trip replay — Reset / Play-Pause / Stop, the
// PlaybackSpeedMenu, and the TimelineScrubber. React Native has no global
// keyboard, so the keyboard-shortcut props (enableKeyboardShortcuts, onSeekBy,
// onSpeedRelative, onStepFrame) are accepted for web parity but not wired; the
// existing onPlay/onPause/onStop/onSpeedChange/onSeek API is preserved.

import React, {type ReactNode} from 'react';
import {Pressable, StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';
import {PlaybackSpeedMenu, type ReplaySpeed} from './PlaybackSpeedMenu';
import {
  TimelineScrubber,
  type TimelineMarker,
  type TimelinePreviewPoint,
} from './TimelineScrubber';

export interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: ReplaySpeed;
  progress: number;
  elapsed: string;
  total: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onSeek: (progress: number) => void;
  markers?: TimelineMarker[];
  getPreviewAt?: (normalized: number) => TimelinePreviewPoint | null;
  scrubberBackground?: ReactNode;
  durationMs?: number;
  /** Accepted for web parity; native has no global keyboard handler. */
  enableKeyboardShortcuts?: boolean;
  /** Accepted for web parity; only fired by the web keyboard handler. */
  onSeekBy?: (deltaSeconds: number) => void;
  /** Accepted for web parity; only fired by the web keyboard handler. */
  onSpeedRelative?: (delta: number) => void;
  /** Accepted for web parity; only fired by the web keyboard handler. */
  onStepFrame?: (delta: number) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function ControlButton({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [styles.button, pressed && styles.pressed]}>
      <AppText style={styles.glyph}>{glyph}</AppText>
    </Pressable>
  );
}

export function PlaybackControls({
  isPlaying,
  speed,
  progress,
  elapsed,
  total,
  onPlay,
  onPause,
  onStop,
  onSpeedChange,
  onSeek,
  markers,
  getPreviewAt,
  scrubberBackground,
  durationMs,
  style,
  testID,
}: PlaybackControlsProps) {
  return (
    <View style={[styles.root, style]} testID={testID}>
      <View style={styles.row}>
        <ControlButton glyph="⏮" label="Reset" onPress={onStop} />
        <ControlButton
          glyph={isPlaying ? '⏸' : '►'}
          label={isPlaying ? 'Pause' : 'Play'}
          onPress={isPlaying ? onPause : onPlay}
        />
        <ControlButton glyph="■" label="Stop" onPress={onStop} />

        <PlaybackSpeedMenu onChange={onSpeedChange} speed={speed} />

        <View style={styles.scrubber}>
          <TimelineScrubber
            background={scrubberBackground}
            duration={durationMs ? durationMs / 1000 : 0}
            getPreviewAt={getPreviewAt}
            markers={markers}
            onSeek={onSeek}
            progress={progress}
          />
        </View>

        <AppText style={styles.time} tone="secondary" variant="caption">
          {`${elapsed} / ${total}`}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  glyph: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.6,
  },
  root: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  scrubber: {
    flex: 1,
    marginHorizontal: 8,
  },
  time: {
    minWidth: 90,
    textAlign: 'right',
  },
});
