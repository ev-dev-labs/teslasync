// Native parity port of
// web/src/features/analytics/components/weekly-digest/WeekSelector.tsx.
//
// The web `WeekSelector` is a single-row toolbar inside a `GlassPanel`
// (`flex items-center justify-between px-5 py-3`): a ghost "Previous" Button on
// the left, a centred `<span>` showing a Calendar icon + the current week label
// + an optional "Current" info Badge, and a ghost "Next" Button on the right
// that is disabled while viewing the current week. It is reproduced here with
// React Native primitives, preserving prop names and i18n keys:
//
//   - `GlassPanel` is imported from the native `components/ui/GlassPanel` (the
//     same shared panel the sibling analytics ports HeroGauges/BatteryTab use);
//     the Tailwind `flex items-center justify-between px-5 py-3` layout becomes a
//     row `style` (paddingHorizontal 20 = px-5, paddingVertical 12 = py-3,
//     justifyContent 'space-between', alignItems 'center').
//   - `Button` is imported from the native parity `web-parity/components/ui/Button`
//     port; the web `onClick` handlers map to its `onPress` prop, while
//     `variant="ghost"`, `size="sm"`, `icon` and `disabled` carry over verbatim.
//   - lucide-react icons are browser/SVG-only, so they become decorative Unicode
//     glyphs in `AppText` (the same approach the Lightbox/Breadcrumbs/PatternsSlide
//     ports took): `ChevronLeft` -> '\u2039' (‹), `ChevronRight` -> '\u203A' (›)
//     tinted with the ghost button's text colour, and `Calendar` -> the '📅'
//     emoji. The Calendar's `text-[var(--text-secondary)]` tint cannot apply to a
//     colour-emoji glyph, so the secondary tint is dropped on that one icon.
//   - react-i18next `useTranslation` is unavailable in native parity; a local
//     `useNativeTranslationFallback` t() shim returns the fallback copy so the
//     visible strings and i18n keys ('analytics.weeklyDigest.prevWeek',
//     '…current', '…nextWeek') are preserved verbatim.
//   - The web `Badge` (`@/components/ui`, variant="info" size="sm") has no shared
//     native port, so it is inlined as a pill `View`+`AppText` reproducing the
//     dark-theme `info` chip exactly: `dark:bg-blue-900` (#1e3a8a) surface,
//     `dark:text-blue-200` (#bfdbfe) text, `rounded-full`, `px-1.5 py-0.5`
//     (6/2 padding), `text-xs` (12) and `font-medium` (500).
//   - The centre `<span>`'s `text-sm font-semibold text-white` typography is
//     applied to the week-label `AppText` (fontSize 14, fontWeight '600',
//     textPrimary); `gap-2` (8) spacing is reproduced with the row `gap`.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {Button} from '../../../../components/ui/Button';

// lucide-react glyph stand-ins (lucide is browser/SVG-only in native parity).
const CHEVRON_LEFT_GLYPH = '\u2039'; // ‹  (ChevronLeft)
const CHEVRON_RIGHT_GLYPH = '\u203A'; // ›  (ChevronRight)
const CALENDAR_GLYPH = '📅'; // Calendar

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key: string, fallback: string) => fallback, []);
}

interface WeekSelectorProps {
  weekLabel: string;
  isCurrentWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}

export function WeekSelector({
  weekLabel,
  isCurrentWeek,
  onPrevWeek,
  onNextWeek,
}: WeekSelectorProps) {
  const t = useNativeTranslationFallback();

  return (
    <GlassPanel style={styles.panel}>
      <Button
        variant="ghost"
        size="sm"
        icon={
          <AppText importantForAccessibility="no" style={styles.chevronGlyph}>
            {CHEVRON_LEFT_GLYPH}
          </AppText>
        }
        onPress={onPrevWeek}>
        {t('analytics.weeklyDigest.prevWeek', 'Previous')}
      </Button>
      <View style={styles.center}>
        <AppText importantForAccessibility="no" style={styles.calendarGlyph}>
          {CALENDAR_GLYPH}
        </AppText>
        <AppText style={styles.weekLabel}>{weekLabel}</AppText>
        {isCurrentWeek ? (
          <View style={styles.badge}>
            <AppText style={styles.badgeText}>
              {t('analytics.weeklyDigest.current', 'Current')}
            </AppText>
          </View>
        ) : null}
      </View>
      <Button
        variant="ghost"
        size="sm"
        icon={
          <AppText importantForAccessibility="no" style={styles.chevronGlyph}>
            {CHEVRON_RIGHT_GLYPH}
          </AppText>
        }
        onPress={onNextWeek}
        disabled={isCurrentWeek}>
        {t('analytics.weeklyDigest.nextWeek', 'Next')}
      </Button>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  // flex items-center justify-between px-5 py-3
  panel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  // flex items-center gap-2 (centre cluster)
  center: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 8,
  },
  // Calendar h-4 w-4 (text-secondary tint cannot apply to a colour emoji).
  calendarGlyph: {
    fontSize: 16,
    lineHeight: 16,
  },
  // ChevronLeft/ChevronRight h-4 w-4 in the ghost button's text colour.
  chevronGlyph: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 16,
  },
  // text-sm font-semibold text-white
  weekLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  // Badge variant="info" size="sm": dark:bg-blue-900 rounded-full px-1.5 py-0.5
  badge: {
    alignItems: 'center',
    backgroundColor: '#1e3a8a',
    borderRadius: 999,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  // Badge text: dark:text-blue-200 text-xs font-medium
  badgeText: {
    color: '#bfdbfe',
    fontSize: 12,
    fontWeight: '500',
  },
});
