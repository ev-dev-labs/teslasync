// Native parity port of web/src/components/status/UptimeHeatmap.tsx.
//
// A rolling N-day status grid: one square per day (oldest on the left), an
// overall uptime-% caption, and an optional footnote. The web component carries
// no i18n and no data fetching — every string (STATUS_LABEL, the default
// "Uptime — last N days" heading) is hardcoded English supplied/derived from the
// caller's `days` array — so the port is a pure presentational mapping. Four web
// dependencies are NOT in the native parity manifest and are replaced with
// native-safe equivalents documented here:
//
//   - `Tooltip` from @/components/ui (web L13, L90-113): the web tooltip reveals
//     each day's date + status label + optional summary on hover / focus-within
//     (tap grants focus on touch devices). React Native has no hover, no
//     :focus-within, and no DOM popover layer, so the reveal becomes an explicit
//     tap-to-toggle popover driven by a `selectedDate` state hook: tapping a
//     square selects it (tapping it again clears) and renders the same
//     date / status-label / summary stack beneath the grid. The web multiline
//     max-w-[260px] body maps to the popover's maxWidth 260; the summary's
//     `border-t border-white/[0.06]` divider is preserved as a borderTop on the
//     summary row.
//
//   - `GlassPanel` from @/components/ui (web L13, L68): mapped to the native
//     GlassPanel (apps/native/src/components/ui/GlassPanel.tsx); the web `p-4`
//     padding moves to a style override and `className` becomes the `style` prop.
//
//   - `cn` from @/lib/cn (web L14): dropped — native uses StyleSheet + style
//     arrays instead of className merging. Every Tailwind class is reproduced as
//     a token-driven style (text-[var(--text-primary)] -> colors.textPrimary,
//     text-[var(--text-muted)] -> colors.textMuted, gap-1 -> spacing.xs,
//     mb-3/mt-3 -> spacing.md, h-3 w-3 -> 12x12, rounded-sm -> radius 2,
//     tabular-nums -> fontVariant ['tabular-nums'], focus-visible:ring-cyan-400/60
//     -> a 1px cyan selected border). The per-status `bg-*-400/80 hover:bg-*-300`
//     pairs become resolved fill / active colours (the web hover brighten is
//     reproduced on the Pressable pressed + selected states).
//
//   - `fmtPercent` from @/lib/numberFormat (web L15, L78): ported inline. The web
//     helper is `${fmtNumber(v, decimals)}%` where fmtNumber is locale-aware
//     (`toLocaleString` at the global locale, en-US default) and coerces
//     non-finite input to 0. Reproduced with Intl.NumberFormat('en-US') (already
//     used by the native operations/fleet formatters) plus a toFixed fallback so
//     the "NN.NN% uptime" caption renders identically.
//
// `HeroStatus` is imported in web from ./StatusHero, which is not yet in the
// native parity tree, so the union is defined + exported locally; a future
// StatusHero port should re-export this same type.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../theme/tokens';

/**
 * Service status union. Ported from web ./StatusHero (`HeroStatus`). Defined
 * locally because StatusHero is not yet in the native parity tree.
 */
export type HeroStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown'
  | 'maintenance';

export interface UptimeDay {
  /** ISO date (yyyy-mm-dd). */
  date: string;
  status: HeroStatus;
  /** Optional short description shown inside the popover. */
  summary?: string;
}

export interface UptimeHeatmapProps {
  days: UptimeDay[];
  /** Title text — defaults to "Uptime — last N days". */
  title?: string;
  /** Footnote text shown beneath the squares. */
  footnote?: string;
  /** Web `className` analogue — extra style applied to the GlassPanel. */
  style?: StyleProp<ViewStyle>;
  /** Web `id` analogue — applied as the panel's nativeID + fallback testID. */
  id?: string;
  testID?: string;
}

interface StatusVisual {
  /** Resting square fill — web `bg-*-400/80` (or zinc-500/40 for unknown). */
  fill: string;
  /** Pressed / selected fill — web `hover:bg-*-300` (zinc-400/60 for unknown). */
  active: string;
  /** Human-readable status label shown in the popover. */
  label: string;
}

const STATUS_VISUAL: Record<HeroStatus, StatusVisual> = {
  healthy: {
    fill: 'rgba(74, 222, 128, 0.8)',
    active: '#86efac',
    label: 'Operational',
  },
  degraded: {
    fill: 'rgba(251, 191, 36, 0.8)',
    active: '#fcd34d',
    label: 'Degraded',
  },
  unhealthy: {
    fill: 'rgba(248, 113, 113, 0.8)',
    active: '#fca5a5',
    label: 'Outage',
  },
  unknown: {
    fill: 'rgba(113, 113, 122, 0.4)',
    active: 'rgba(161, 161, 170, 0.6)',
    label: 'Unknown',
  },
  maintenance: {
    fill: 'rgba(96, 165, 250, 0.8)',
    active: '#93c5fd',
    label: 'Maintenance',
  },
};

// Uptime caption colour thresholds — web text-green-400 / amber-400 / red-400.
const UPTIME_GOOD = '#4ade80';
const UPTIME_WARN = '#fbbf24';
const UPTIME_BAD = '#f87171';

// Inline port of web fmtPercent(fmtNumber(v, decimals)) — locale-aware with a
// non-finite -> 0 guard, matching web/src/lib/numberFormat.ts.
function fmtPercent(value: number, decimals: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(safe)}%`;
  } catch {
    return `${safe.toFixed(decimals)}%`;
  }
}

export function UptimeHeatmap({
  days,
  title,
  footnote,
  style,
  id,
  testID,
}: UptimeHeatmapProps): React.ReactElement {
  const uptimePct = useMemo(() => {
    if (days.length === 0) {
      return null;
    }
    const healthy = days.filter(
      d => d.status === 'healthy' || d.status === 'maintenance',
    ).length;
    return (healthy / days.length) * 100;
  }, [days]);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const heading = title ?? `Uptime — last ${days.length} days`;

  const selectedDay = useMemo(
    () =>
      selectedDate ? days.find(d => d.date === selectedDate) ?? null : null,
    [days, selectedDate],
  );

  const handleSelect = useCallback((date: string) => {
    setSelectedDate(prev => (prev === date ? null : date));
  }, []);

  const uptimeColor =
    uptimePct == null
      ? colors.textMuted
      : uptimePct >= 99
        ? UPTIME_GOOD
        : uptimePct >= 95
          ? UPTIME_WARN
          : UPTIME_BAD;

  return (
    <GlassPanel
      nativeID={id}
      testID={testID ?? id}
      style={[styles.panel, style]}>
      <View style={styles.header}>
        <AppText style={styles.heading}>{heading}</AppText>
        {uptimePct != null ? (
          <AppText style={[styles.uptime, {color: uptimeColor}]}>
            {`${fmtPercent(uptimePct, 2)} uptime`}
          </AppText>
        ) : null}
      </View>

      <View
        accessibilityLabel="Daily status history"
        style={styles.grid}
        testID="uptime-grid">
        {days.map(day => {
          const visual = STATUS_VISUAL[day.status];
          const isSelected = day.date === selectedDate;
          return (
            <Pressable
              key={day.date}
              accessibilityRole="button"
              accessibilityLabel={`${day.date}: ${visual.label}`}
              accessibilityState={{selected: isSelected}}
              onPress={() => handleSelect(day.date)}
              style={({pressed}) => [
                styles.square,
                {
                  backgroundColor:
                    pressed || isSelected ? visual.active : visual.fill,
                },
                isSelected && styles.squareSelected,
              ]}
              testID={`uptime-day-${day.date}`}
            />
          );
        })}
      </View>

      {selectedDay ? (
        <View style={styles.popover} testID="uptime-popover">
          <AppText style={styles.popoverDate}>{selectedDay.date}</AppText>
          <AppText style={styles.popoverStatus}>
            {STATUS_VISUAL[selectedDay.status].label}
          </AppText>
          {selectedDay.summary ? (
            <AppText style={styles.popoverSummary}>
              {selectedDay.summary}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {footnote ? <AppText style={styles.footnote}>{footnote}</AppText> : null}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  footnote: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  header: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  panel: {
    padding: spacing.md,
  },
  popover: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.md,
    maxWidth: 260,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  popoverDate: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  popoverStatus: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  popoverSummary: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
  },
  square: {
    borderRadius: 2,
    flexShrink: 0,
    height: 12,
    width: 12,
  },
  squareSelected: {
    borderColor: 'rgba(53, 213, 255, 0.6)',
    borderWidth: 1,
  },
  uptime: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
});

export default UptimeHeatmap;
