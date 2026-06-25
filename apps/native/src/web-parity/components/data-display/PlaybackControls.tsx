// Native parity port of web/src/components/data-display/PlaybackControls.tsx.
// Playback control bar for trip replay — Reset / Play-Pause / Stop, the
// PlaybackSpeedMenu, and the TimelineScrubber. The existing
// onPlay/onPause/onStop/onSpeedChange/onSeek API is preserved unchanged.
//
// The web component layers page-scoped keyboard shortcuts on top via a global
// `window.addEventListener('keydown', …)` handler, a transient on-key toast
// (`shortcutToast`), and a route-scoped `useShortcut` cheatsheet registry. Core
// React Native exposes no portable global hardware-key event source and the
// native tsconfig ships no DOM lib, so those three are native-unavailable; the
// keyboard-shortcut props (enableKeyboardShortcuts, onSeekBy, onSpeedRelative,
// onStepFrame, durationMs) are kept on the prop surface for parity. The web
// `<Tooltip>` help popover (helpContent) IS ported: when enableKeyboardShortcuts
// is true a keyboard button reveals the same shortcut reference in a native
// Modal popover (tap to dismiss).

import React, {useState, type ReactNode} from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {PlaybackSpeedMenu, type ReplaySpeed} from './PlaybackSpeedMenu';
import {
  TimelineScrubber,
  type TimelineMarker,
  type TimelinePreviewPoint,
} from './TimelineScrubber';

export interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: ReplaySpeed;
  /** 0..1 normalized playback position. */
  progress: number;
  /** Pre-formatted elapsed time (e.g. "1:23"). */
  elapsed: string;
  /** Pre-formatted total time (e.g. "5:10"). */
  total: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onSeek: (progress: number) => void;
  /** Optional notable moments rendered as tick marks on the scrubber. */
  markers?: TimelineMarker[];
  /** Optional sampler for hover/scrub previews. */
  getPreviewAt?: (normalized: number) => TimelinePreviewPoint | null;
  /** Optional decorative background rendered behind the scrubber track. */
  scrubberBackground?: ReactNode;
  /** Total duration in milliseconds (drives keyboard seek-by-seconds on web). */
  durationMs?: number;
  /**
   * Reveals the keyboard-shortcut reference popover. The shortcuts themselves
   * are driven by the web global key listener, which has no native equivalent.
   */
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

/**
 * Keyboard cheatsheet rows. Mirrors the web `helpContent` grid + the
 * `useShortcut` registry descriptions one-for-one, using the same English
 * fallback strings the web `t(key, fallback)` calls resolve to.
 */
const SHORTCUT_ROWS: {keys: string; description: string}[] = [
  {keys: 'Space / K', description: 'Play / Pause'},
  {keys: '\u2190 / \u2192', description: 'Skip \u00b15s (Shift = \u00b130s)'},
  {keys: 'J / L', description: 'Skip \u00b110s'},
  {keys: ', / .', description: 'Previous / next frame'},
  {keys: 'Home / End', description: 'Jump to start / end'},
  {keys: '0 \u2013 9', description: 'Jump to N\u00d710%'},
  {keys: '+ / \u2212', description: 'Speed up / slow down'},
];

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
  enableKeyboardShortcuts = false,
  style,
  testID,
}: PlaybackControlsProps) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <View style={[styles.root, style]} testID={testID}>
      <View style={styles.row}>
        {/* Reset (rewind to start) — lucide SkipBack */}
        <ControlButton glyph={'\u23ee'} label="Reset" onPress={onStop} />

        {/* Play / Pause — lucide Pause / Play */}
        <ControlButton
          glyph={isPlaying ? '\u23f8' : '\u25ba'}
          label={isPlaying ? 'Pause' : 'Play'}
          onPress={isPlaying ? onPause : onPlay}
        />

        {/* Stop — lucide Square */}
        <ControlButton glyph={'\u25a0'} label="Stop" onPress={onStop} />

        {/* Speed */}
        <PlaybackSpeedMenu onChange={onSpeedChange} speed={speed} />

        {/* Scrubber takes the remaining space */}
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

        {/* Time display */}
        <AppText style={styles.time} tone="secondary" variant="caption">
          {`${elapsed} / ${total}`}
        </AppText>

        {/* Keyboard help */}
        {enableKeyboardShortcuts ? (
          <ControlButton
            glyph={'\u2328'}
            label="Show keyboard shortcuts"
            onPress={() => setHelpOpen(true)}
          />
        ) : null}
      </View>

      {enableKeyboardShortcuts ? (
        <Modal
          animationType="fade"
          onRequestClose={() => setHelpOpen(false)}
          transparent
          visible={helpOpen}>
          <Pressable style={styles.overlay} onPress={() => setHelpOpen(false)}>
            <Pressable style={styles.helpCard} onPress={() => undefined}>
              <AppText style={styles.helpTitle} variant="caption" weight="semibold">
                Trip replay shortcuts
              </AppText>
              <View style={styles.helpGrid}>
                {SHORTCUT_ROWS.map(rowItem => (
                  <View key={rowItem.keys} style={styles.helpRow}>
                    <AppText style={styles.kbd} variant="caption">
                      {rowItem.keys}
                    </AppText>
                    <AppText
                      style={styles.helpDesc}
                      tone="secondary"
                      variant="caption">
                      {rowItem.description}
                    </AppText>
                  </View>
                ))}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const MONO = Platform.select({ios: 'Courier', default: 'monospace'});

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
  helpCard: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    margin: spacing.lg,
    maxWidth: 340,
    padding: spacing.md,
    width: '92%',
    ...shadows.panel,
  },
  helpDesc: {
    flex: 1,
  },
  helpGrid: {
    gap: 6,
  },
  helpRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  helpTitle: {
    color: colors.textPrimary,
  },
  kbd: {
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
    borderColor: 'rgba(148, 163, 184, 0.3)',
    borderRadius: 4,
    borderWidth: 1,
    color: colors.textSecondary,
    fontFamily: MONO,
    minWidth: 92,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
    textAlign: 'center',
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
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
    fontFamily: MONO,
    minWidth: 90,
    textAlign: 'right',
  },
});
