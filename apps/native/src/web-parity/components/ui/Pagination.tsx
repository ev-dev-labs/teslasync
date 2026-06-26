// Native parity port of web/src/components/ui/Pagination.tsx.
//
// Table pagination controls with first/prev/next/last buttons and an optional
// page-size selector (source L13-20 docblock). Every source line was considered;
// each browser-only dependency is reduced to an explicit native-safe analog and
// documented in the .parity.json sidecar:
//   - lucide-react ChevronLeft / ChevronRight / ChevronsLeft / ChevronsRight
//     (source L1): lucide is a DOM/SVG library. The four chevrons become inert
//     AppText guillemet glyphs (« ‹ › ») tinted with the muted token, marked
//     importantForAccessibility="no" to mirror the web `aria-hidden` on the
//     icons (the Pressable still carries the localized aria-label).
//   - react-i18next useTranslation (source L2, L22): React Native has no i18n
//     provider wired yet, so a useNativeTranslationFallback() returns the English
//     default and interpolates the i18next-style `{{name}}` placeholders, matching
//     the sibling SignalQueryControls / BulkActionsToolbar ports. The exact key +
//     default-copy + interpolation-value call sites are preserved verbatim.
//   - Tailwind className strings (source L30, L32, L41, L54, L63 …): meaningless
//     on React Native; reproduced with StyleSheet objects. The responsive
//     `flex-col sm:flex-row` is collapsed to a single wrapping row (the >=sm web
//     layout) since the native target is mobile and RN has no CSS breakpoints.
//   - HTML `<nav aria-label>` landmark (source L28-29): RN has no nav landmark,
//     so the container is a View with accessibilityRole="toolbar" carrying the
//     same localized label, left non-`accessible` so each control stays focusable.
//   - `aria-live="polite"` on the count copy (source L33): mapped to RN
//     accessibilityLiveRegion="polite"; `aria-atomic` has no RN analog (the whole
//     string is one Text node, so it is announced atomically anyway).
//   - HTML `<select>` page-size dropdown (source L37-48): RN core has no <select>;
//     it becomes a segmented row of pressable radio chips (one per option) — the
//     same conversion the SignalQueryControls port uses — preserving every option,
//     the localized "{{count}} / page" label, and the onChange -> onPageSizeChange
//     behavior. `aria-current="page"` (source L64) -> the indicator's
//     accessibilityLabel, since RN has no aria-current.
//   - HTML `<button disabled>` (source L52-78): Pressable with accessibilityRole
//     "button", the localized accessibilityLabel, disabled wiring, and a pressed
//     style standing in for the web `hover:` styles (no hover on touch).

import React, {useCallback} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

// ── native translation fallback (native-safe port of react-i18next, source L2) ──
type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

// Native analogs of the lucide chevron icons (source L1). Inert guillemet glyphs
// tinted with the muted token; the Pressable carries the accessible label.
const FIRST_GLYPH = '\u00AB'; // « — ChevronsLeft
const PREV_GLYPH = '\u2039'; // ‹ — ChevronLeft
const NEXT_GLYPH = '\u203A'; // › — ChevronRight
const LAST_GLYPH = '\u00BB'; // » — ChevronsRight

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

interface NavButtonProps {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID: string;
}

/**
 * One of the four first/prev/next/last controls. Extracted (DRY) to replace the
 * four near-identical web `<button>`s (source L52-78). The chevron glyph is
 * decorative; the Pressable owns the localized accessibility label.
 */
function NavButton({glyph, label, disabled, onPress, testID}: NavButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.navButton,
        disabled && styles.navButtonDisabled,
        pressed && !disabled && styles.navButtonPressed,
      ]}
      testID={testID}>
      <AppText
        importantForAccessibility="no"
        style={styles.navGlyph}>
        {glyph}
      </AppText>
    </Pressable>
  );
}

/**
 * Table pagination controls with first/prev/next/last buttons and optional
 * page-size selector. Native parity port of the web Pagination.
 *
 * Accessibility: the control set is wrapped in a toolbar landmark so screen
 * readers announce it as a pagination region. The "showing X–Y of Z" copy lives
 * inside an accessibilityLiveRegion="polite" region so the count update is
 * announced as the user pages without stealing focus.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
}: PaginationProps) {
  const t = useNativeTranslationFallback();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <View
      accessibilityLabel={t('a11y.pagination', 'Pagination')}
      accessibilityRole="toolbar"
      style={styles.nav}
      testID="pagination">
      <View style={styles.metaRow}>
        <AppText
          accessibilityLiveRegion="polite"
          style={styles.showing}
          testID="pagination-showing">
          {t('pagination.showing', 'Showing {{start}}–{{end}} of {{total}}', {
            start: total > 0 ? start : 0,
            end,
            total,
          })}
        </AppText>
        {onPageSizeChange ? (
          <View
            accessibilityLabel={t('pagination.pageSize', 'Rows per page')}
            accessibilityRole="radiogroup"
            style={styles.sizeRow}
            testID="pagination-page-size">
            {pageSizeOptions.map(s => {
              const selected = pageSize === s;
              return (
                <Pressable
                  key={s}
                  accessibilityLabel={t('pagination.perPage', '{{count}} / page', {
                    count: s,
                  })}
                  accessibilityRole="radio"
                  accessibilityState={{selected}}
                  onPress={() => onPageSizeChange(Number(s))}
                  style={({pressed}) => [
                    styles.sizeChip,
                    selected && styles.sizeChipActive,
                    pressed && !selected && styles.sizeChipPressed,
                  ]}
                  testID={`pagination-page-size-${s}`}>
                  <AppText
                    style={[
                      styles.sizeChipText,
                      selected && styles.sizeChipTextActive,
                    ]}>
                    {t('pagination.perPage', '{{count}} / page', {count: s})}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
      <View style={styles.controls}>
        <NavButton
          disabled={page <= 1}
          glyph={FIRST_GLYPH}
          label={t('pagination.first', 'First page')}
          onPress={() => onPageChange(1)}
          testID="pagination-first"
        />
        <NavButton
          disabled={page <= 1}
          glyph={PREV_GLYPH}
          label={t('pagination.previous', 'Previous page')}
          onPress={() => onPageChange(page - 1)}
          testID="pagination-previous"
        />
        <AppText
          accessibilityLabel={t('pagination.currentPage', 'Page {{page}} of {{total}}', {
            page,
            total: totalPages,
          })}
          accessibilityRole="text"
          style={styles.indicator}
          testID="pagination-indicator">
          {page} / {totalPages}
        </AppText>
        <NavButton
          disabled={page >= totalPages}
          glyph={NEXT_GLYPH}
          label={t('pagination.next', 'Next page')}
          onPress={() => onPageChange(page + 1)}
          testID="pagination-next"
        />
        <NavButton
          disabled={page >= totalPages}
          glyph={LAST_GLYPH}
          label={t('pagination.last', 'Last page')}
          onPress={() => onPageChange(totalPages)}
          testID="pagination-last"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  showing: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  sizeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  sizeChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sizeChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  sizeChipPressed: {
    backgroundColor: colors.surfaceHover,
  },
  sizeChipText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  sizeChipTextActive: {
    color: colors.textPrimary,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  navButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  navGlyph: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 20,
  },
  indicator: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '500',
    paddingHorizontal: spacing.md,
  },
});
