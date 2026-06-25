/**
 * ActiveFilterChips — native parity port of
 * web/src/components/forms/ActiveFilterChips.tsx.
 *
 * Renders one chip per active filter ("Vehicle: Model 3 ×"), an optional
 * "Clear all" affordance, and an a11y live region that announces removals.
 *
 * Designed to be mounted immediately after a filter bar so users never have to
 * re-open a control to learn what's filtering the current view.
 *
 * State is owned by the page; chips are a presentation surface — every removal
 * flows through the descriptor's `onRemove` callback so the page stays in
 * charge of how the underlying query/URL state is rewritten.
 *
 * Native adaptations vs. the web source:
 *   - The DOM outside-click + Escape `useEffect` (web L84-100) is replaced by a
 *     React Native `Modal` whose backdrop press + `onRequestClose` (hardware
 *     back) collapse the overflow popover.
 *   - The `<Icon icon={Icons.close} />` lucide glyph becomes the native
 *     SemanticIcon 'close' glyph rendered as text inside the remove button.
 *   - `react-i18next` is replaced by a native-safe translation fallback that
 *     preserves the original keys, English fallbacks, and `{{label}}`/`{{count}}`
 *     interpolation.
 *   - The web Backspace/Delete chip keyboard shortcut (web L152-160) has no
 *     touch-native equivalent and is intentionally dropped; removal stays
 *     available through the close button.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';

import {VisuallyHidden} from '../a11y';
import {getSemanticIconDefinition} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

type InterpolationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

/**
 * Description of one chip — typically derived from a single active filter.
 *
 * `key` should match the filter param name so chips are stable and uniquely
 * keyable. `label` is the i18n'd field name (e.g. "Vehicle"), `value` is the
 * user-facing value (e.g. "Model 3"). `onRemove` should delete the param.
 */
export interface FilterChipDescriptor {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

export interface ActiveFilterChipsProps {
  filters: readonly FilterChipDescriptor[];
  /** When provided, renders a "Clear all" affordance after the chips. */
  onClearAll?: () => void;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /**
   * When true (default), the component renders nothing if `filters` is empty
   * AND there is nothing to clear.
   */
  hideWhenEmpty?: boolean;
  /**
   * Maximum number of chips rendered inline. The remaining chips collapse into
   * a "+N more" trigger that opens a small popover. Default 8.
   */
  maxVisible?: number;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, options) => {
    if (!options) {
      return fallback;
    }
    return interpolate(fallback, options);
  }, []);
}

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

const CLOSE_GLYPH = getSemanticIconDefinition('close').glyph;

/**
 * ActiveFilterChips — see file header for the contract.
 */
export function ActiveFilterChips({
  filters,
  onClearAll,
  className: _className,
  hideWhenEmpty = true,
  maxVisible = 8,
}: ActiveFilterChipsProps) {
  const t = useNativeTranslationFallback();
  const [removalAnnouncement, setRemovalAnnouncement] = useState('');
  const [overflowOpen, setOverflowOpen] = useState(false);

  // Announcement is a transient string; we never queue, but if a second
  // removal lands within the same render cycle, the live region sees a fresh
  // string (we suffix a zero-width counter) so assistive tech re-reads it.
  const announceCounterRef = useRef(0);

  // When filters drop to zero, also collapse the overflow popover.
  useEffect(() => {
    if (filters.length === 0 && overflowOpen) {
      setOverflowOpen(false);
    }
  }, [filters.length, overflowOpen]);

  const {visible, overflow} = useMemo(() => {
    if (maxVisible <= 0) {
      return {visible: [] as FilterChipDescriptor[], overflow: [...filters]};
    }
    if (filters.length <= maxVisible) {
      return {visible: [...filters], overflow: [] as FilterChipDescriptor[]};
    }
    // When we need an overflow bucket, leave room for the "+N more" trigger by
    // reserving one of the visible slots for it.
    const visibleCount = Math.max(0, maxVisible - 1);
    return {
      visible: filters.slice(0, visibleCount),
      overflow: filters.slice(visibleCount),
    };
  }, [filters, maxVisible]);

  const isEmpty = filters.length === 0;
  if (hideWhenEmpty && isEmpty) {
    return null;
  }

  const announceRemoval = (descriptor: FilterChipDescriptor) => {
    announceCounterRef.current += 1;
    // Trailing zero-width spaces force a fresh string for AT re-announce.
    const padding = '\u200B'.repeat(announceCounterRef.current % 4);
    setRemovalAnnouncement(
      `${t('filters.removed', 'Filter removed')}: ${descriptor.label}${padding}`,
    );
  };

  const handleRemove = (descriptor: FilterChipDescriptor) => {
    announceRemoval(descriptor);
    descriptor.onRemove();
  };

  const handleClearAll = () => {
    if (!onClearAll) {
      return;
    }
    announceCounterRef.current += 1;
    const padding = '\u200B'.repeat(announceCounterRef.current % 4);
    setRemovalAnnouncement(
      `${t('filters.clearedAll', 'All filters cleared')}${padding}`,
    );
    onClearAll();
  };

  return (
    <View
      accessibilityLabel={t('filters.activeLabel', 'Active filters')}
      style={styles.container}
      testID="active-filter-chips">
      {visible.map(descriptor => (
        <Chip
          descriptor={descriptor}
          key={descriptor.key}
          onRemove={handleRemove}
        />
      ))}

      {overflow.length > 0 ? (
        <>
          <Pressable
            accessibilityLabel={t('filters.moreCount', '+{{count}} more', {
              count: overflow.length,
            })}
            accessibilityRole="button"
            accessibilityState={{expanded: overflowOpen}}
            hitSlop={6}
            onPress={() => setOverflowOpen(value => !value)}
            style={({pressed}) => [
              styles.moreTrigger,
              overflowOpen && styles.moreTriggerOpen,
              pressed && styles.moreTriggerPressed,
            ]}>
            <AppText tone="secondary" variant="caption" weight="semibold">
              {t('filters.moreCount', '+{{count}} more', {
                count: overflow.length,
              })}
            </AppText>
          </Pressable>

          <Modal
            animationType="fade"
            onRequestClose={() => setOverflowOpen(false)}
            transparent
            visible={overflowOpen}>
            <View style={styles.overlay}>
              <Pressable
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                onPress={() => setOverflowOpen(false)}
                style={styles.backdrop}
              />
              <View
                accessibilityLabel={t(
                  'filters.moreLabel',
                  'Additional active filters',
                )}
                accessibilityRole="menu"
                style={styles.popover}
                testID="active-filter-chips-overflow">
                {overflow.map(descriptor => (
                  <Chip
                    descriptor={descriptor}
                    fullWidth
                    key={descriptor.key}
                    onRemove={d => {
                      handleRemove(d);
                      if (overflow.length === 1) {
                        setOverflowOpen(false);
                      }
                    }}
                  />
                ))}
              </View>
            </View>
          </Modal>
        </>
      ) : null}

      {onClearAll && filters.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={6}
          onPress={handleClearAll}
          style={({pressed}) => [
            styles.clearAll,
            pressed && styles.clearAllPressed,
          ]}
          testID="active-filter-chips-clear-all">
          <AppText tone="secondary" variant="caption" weight="semibold">
            {t('filters.clearAll', 'Clear all')}
          </AppText>
        </Pressable>
      ) : null}

      {/* a11y live region — announces individual removals + clear-all. */}
      <VisuallyHidden liveRegion>{removalAnnouncement}</VisuallyHidden>
    </View>
  );
}

ActiveFilterChips.displayName = 'ActiveFilterChips';

interface ChipProps {
  descriptor: FilterChipDescriptor;
  onRemove: (descriptor: FilterChipDescriptor) => void;
  fullWidth?: boolean;
}

function Chip({descriptor, onRemove, fullWidth = false}: ChipProps) {
  const t = useNativeTranslationFallback();
  const removeLabel = t('filters.removeAria', 'Remove filter {{label}}', {
    label: descriptor.label,
  });

  return (
    <View style={[styles.chip, fullWidth && styles.chipFullWidth]}>
      <AppText numberOfLines={1} style={styles.chipText} variant="caption">
        <AppText tone="muted" variant="caption">
          {`${descriptor.label}: `}
        </AppText>
        <AppText tone="primary" variant="caption" weight="semibold">
          {descriptor.value}
        </AppText>
      </AppText>
      <Pressable
        accessibilityLabel={removeLabel}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => onRemove(descriptor)}
        style={({pressed}) => [
          styles.chipRemove,
          pressed && styles.chipRemovePressed,
        ]}>
        <AppText
          style={styles.chipRemoveGlyph}
          tone="muted"
          variant="caption"
          weight="bold">
          {CLOSE_GLYPH}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
  },
  chipFullWidth: {
    justifyContent: 'space-between',
    width: '100%',
  },
  chipRemove: {
    alignItems: 'center',
    borderRadius: 999,
    flexShrink: 0,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  chipRemoveGlyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  chipRemovePressed: {
    backgroundColor: colors.surfaceHover,
  },
  chipText: {
    flexShrink: 1,
  },
  clearAll: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
  },
  clearAllPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  moreTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
  },
  moreTriggerOpen: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  moreTriggerPressed: {
    backgroundColor: colors.surfaceHover,
  },
  overlay: {
    alignItems: 'flex-start',
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
  },
  popover: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.xl,
    maxWidth: 320,
    minWidth: 192,
    padding: spacing.sm,
  },
});
