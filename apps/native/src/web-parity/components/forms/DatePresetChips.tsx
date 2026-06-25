// Native parity port of web/src/components/forms/DatePresetChips.tsx.
//
// DatePresetChips — quick-select chip row for date ranges. Renders a row of
// pressable chips, one per preset id, and calls onSelect with the preset id and
// the resolved {start, end} ISO date strings. Standalone — works inside the
// ported DateRangeFilter or any custom date filter (signal-log time window,
// alert history, etc.).
//
// Web -> native mapping notes:
//   - The shared web <Button> chips become inline Pressable chips (the same
//     approach PlaybackControls uses) so the web `size` ('sm' | 'md') scale and
//     the active highlight (Button variant 'primary' when active, 'ghost'
//     otherwise) are preserved. Native AppButton exposes neither a size nor an
//     aria-pressed surface, so it is intentionally not reused here.
//   - react-i18next useTranslation -> inlined useNativeTranslationFallback()
//     returning the web English fallback copy verbatim (no interpolation is
//     needed here), matching the established ImpersonationBanner pattern.
//   - The web wrapper `<div role="group" aria-label=…>` becomes a View carrying
//     the same accessible group name; the web `aria-pressed` maps to each chip's
//     accessibilityState `selected`.
//   - The web `className` pass-through (a flex-row utility hook) has no native
//     analogue and is replaced by a `style` pass-through (StyleProp<ViewStyle>)
//     plus an optional `testID`, mirroring the PlaybackControls parity port.
//   - DATE_PRESETS / DEFAULT_PRESET_IDS come from the ported, DOM-free
//     web-parity lib/datePresets so the chip data stays DRY and identical to web.

import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {DATE_PRESETS, DEFAULT_PRESET_IDS} from '../../lib/datePresets';

export interface DatePresetSelection {
  id: string;
  start: string;
  end: string;
}

export interface DatePresetChipsProps {
  /** Subset of preset ids to render. Defaults to DEFAULT_PRESET_IDS. */
  presetIds?: readonly string[];
  /** Optional id of the currently active preset (for highlight). */
  activeId?: string;
  /** Called when a chip is pressed. */
  onSelect: (selection: DatePresetSelection) => void;
  /** Chip size — matches the shared Button size scale. */
  size?: 'sm' | 'md';
  /** Optional override for the group's accessible name. */
  ariaLabel?: string;
  /** Pass-through style for the wrapping row (replaces the web className hook). */
  style?: StyleProp<ViewStyle>;
  /** Pass-through test id for the wrapping row. */
  testID?: string;
}

function useNativeTranslationFallback(): (
  key: string,
  fallback: string,
) => string {
  return React.useCallback((_key: string, fallback: string) => fallback, []);
}

export function DatePresetChips({
  presetIds = DEFAULT_PRESET_IDS,
  activeId,
  onSelect,
  size = 'sm',
  ariaLabel,
  style,
  testID,
}: DatePresetChipsProps) {
  const t = useNativeTranslationFallback();
  const ids = new Set(presetIds);
  const presets = DATE_PRESETS.filter(p => ids.has(p.id));

  return (
    <View
      accessibilityLabel={ariaLabel ?? t('date.preset.label', 'Quick date range')}
      style={[styles.row, style]}
      testID={testID}>
      {presets.map(p => {
        const active = p.id === activeId;
        const label = t(p.i18nKey, p.fallback);
        return (
          <Pressable
            key={p.id}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => {
              const r = p.resolve();
              onSelect({id: p.id, start: r.start, end: r.end});
            }}
            style={({pressed}) => [
              styles.chip,
              size === 'md' ? styles.chipMd : styles.chipSm,
              active ? styles.chipActive : styles.chipGhost,
              pressed && styles.chipPressed,
            ]}
            testID={`date-preset-chip-${p.id}`}>
            <AppText
              style={[
                size === 'md' ? styles.labelMd : styles.labelSm,
                active ? styles.labelActive : styles.labelGhost,
              ]}
              weight="semibold">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
  },
  chipSm: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipMd: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  chipPressed: {
    opacity: 0.82,
  },
  labelSm: {
    fontSize: 12,
    lineHeight: 16,
  },
  labelMd: {
    fontSize: 14,
    lineHeight: 18,
  },
  labelActive: {
    color: colors.background,
  },
  labelGhost: {
    color: colors.textPrimary,
  },
});

export default DatePresetChips;
