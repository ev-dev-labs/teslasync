// Native parity port of
// web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx.
//
// `DrivingCoachSection` is the "Driving Coach" block of the Driving Dynamics
// page. It renders, in order:
//   1. A section heading ("Driving Coach").
//   2. A three-up row (mobile-first single column) of panels:
//        a. RadialGauge of the overall driving score (+ "{{count}} drives
//           analyzed") with a green/amber/red colour threshold (>=75 / >=50 /
//           else) preserved verbatim.
//        b. A "Style Breakdown" panel: a segmented bar (efficient / moderate /
//           aggressive widths by share of total drives) plus a colour-keyed
//           legend, OR an EmptyState when no drives have been analysed.
//        c. Two StatCards (Avg / Best efficiency in Wh/km).
//   3. A "Weekly Score Trend" line chart (or EmptyState when < 2 weeks).
//   4. "Driving Patterns" progress indicators (hard accel/brake, highway, short
//      trips, cold starts) with lo/hi colour thresholds.
//   5. "Recommendations" — impact-badged tips, or EmptyState.
//   6. "Per-Drive Scores" — a DataTable of recent drives, or EmptyState.
// Every prop/state name (`coachData`), API field (overall_score,
// efficiency_wh_km, best_efficiency_wh_km, total_drives_analyzed,
// style_breakdown, patterns.*_pct, weekly_trend, recommendations,
// per_drive_scores, CoachDriveScore.drive_id/date/score/style/efficiency/
// distance), every i18n key + English fallback, every colour threshold, the
// `lo`/`hi` pattern bounds, and the FadeIn delay cadence (0.42 → 0.49) are
// preserved verbatim. Unit strings ("Wh/km", "km", "%") are passed through
// exactly as the source (no unit conversion happens in this component — the
// efficiency values are already Wh/km and distance already km from the hook).
//
// Web module -> native-safe mappings (contract rules 4-7):
//   - `@/components/ui` GlassPanel (L5) -> the native `components/ui/GlassPanel`
//     (glass surface + border + radius). The web `p-6` / layout classes have no
//     className channel on native, so padding/centering/gap move to a `style`
//     prop (GlassPanel forwards `style` onto its View).
//   - `@/components/ui` Badge + Column (L5) -> the web-parity `components/ui`
//     Badge and DataTable ports. Variant/size and the Column<T> public API are
//     preserved field-for-field.
//   - `@/components/ui` DataTable (L5) -> the web-parity `components/ui/DataTable`
//     port. `tableId`, `keyExtractor`, `compact`, `pagination`, `emptyMessage`
//     are passed through verbatim; the port renders a native scrollable table
//     (sorting/pagination intact) instead of a DOM `<table>`.
//   - `@/components/charts` (L6-17: ChartTooltip, RadialGauge, AREA_DEFAULTS,
//     LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer)
//     -> the web-parity `components/charts` barrel. RadialGauge / ChartTooltip /
//     AREA_DEFAULTS are real native ports; ResponsiveContainer / LineChart /
//     Line / XAxis / YAxis / CartesianGrid / Tooltip are the barrel's native
//     chart-primitive stubs. Recharts is a browser DOM/SVG renderer with no
//     native backend, so the weekly-trend recharts JSX shape is preserved 1:1
//     but the stubs render an accessibility-labelled "unavailable" placeholder
//     and IGNORE every styling prop (stroke, dot, domain, tick, tickLine,
//     axisLine, strokeDasharray, dataKey, name, content, and the spread
//     AREA_DEFAULTS). The inert prop values are carried over verbatim to
//     document visual intent. Visual line rendering is UNAVAILABLE on native
//     (documented in the sidecar); the RadialGauge gauge and every numeric/text
//     panel renders fully.
//   - `@/components/data-display` StatCard (L18) -> a local StatCard mirroring
//     the web public API (label, value, unit?, icon?, trend?, sublabel?); no
//     native data-display StatCard port exists yet, same precedent as the
//     ChargingDetailPage port's local StatCard.
//   - `@/components/feedback` EmptyState (L19) -> a local EmptyState mirroring
//     the WEB feedback EmptyState API (message required, title/icon optional).
//     The native `components/feedback/EmptyState` REQUIRES a title, but every
//     call site here passes only `message`, so a faithful local mirror is used.
//     The web `action`/`actionTo` CTAs are unused by this component (all sites
//     are the documented no-action transient empty state).
//   - `@/components/motion` FadeIn (L20) -> the ported web-parity components/
//     motion FadeIn; the 0.42 → 0.49 second delays are preserved (the native
//     FadeIn delay is likewise expressed in seconds).
//   - `@/lib/numberFormat` fmtNumber (L21) -> inlined native-safe equivalent
//     (+ safeNumber dep): nullish/non-finite -> 0, en-US locale, the web default
//     precision (2) honoured (every source call uses the default precision).
//   - `@/lib/dateFormat` formatDateShort (L22) -> inlined native-safe equivalent:
//     nullish/invalid -> "—", else the short "Mon D" form via toLocaleDateString
//     (browser locale) with a month-name fallback for ICU-less runtimes.
//   - `@/lib/cn` cn (L23) -> dropped. `cn` only merged Tailwind class strings;
//     React Native has no className, so the class-driven styling moves to
//     StyleSheet + token colour literals.
//   - `@/types/driving` DrivingCoachData / CoachDriveScore (L24) -> imported from
//     the native `api/hooks/useDriving` port, whose interfaces match the web
//     shapes field-for-field.
//   - lucide-react Zap / ShieldCheck / Lightbulb (L3) -> decorative emoji glyphs
//     via `Glyph` (accessibility-hidden); the adjacent label always carries the
//     meaning. Same precedent as the ChargingDetailPage lucide substitution.
//   - react-i18next useTranslation (L2) -> a local key-preserving fallback shim
//     returning the inline English copy (key when no default) with `{{count}}`
//     interpolation support, so every i18n key + interpolation intent survives
//     (no react-i18next in the native deps).
//
// DOM -> native element mapping: every web `<div>`/`<h2>`/`<h3>`/`<p>`/`<span>`
// becomes a `View`/`AppText`. Tailwind classes map to StyleSheet/token styles
// (1 spacing unit = 4px: p-6 -> 24, gap-4 -> 16, gap-3 -> 12, gap-2 -> 8,
// space-y-1 -> 4, mb-4 -> 16, h-4 -> 16, h-2 -> 8, h-1.5 -> 6). The neon bar
// fills use the web tailwind neon hexes (green #10b981, amber #f59e0b, red
// #ef4444 == red-500); legend/value text uses the toned web hexes (emerald-300
// #6ee7b7, amber-300 #fcd34d, red-400 #f87171); gauge/line strokes keep the
// source #22c55e / #f59e0b / #ef4444. `var(--text-primary)` / `var(--text-
// secondary)` map to the AppText primary / secondary tones. The source's bare
// Fragment is wrapped in a single gap-16 root View — React Native has no
// document-flow margins, so a stacking container provides the vertical rhythm
// the web parent page supplied via space-y. No DOM-only modules, browser HTML
// elements, Recharts, Leaflet, or old web UI components are imported.

import React, { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';

import {
  ChartTooltip,
  RadialGauge,
  AREA_DEFAULTS,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '../../../../components/charts';
import { Badge } from '../../../../components/ui/Badge';
import { DataTable, type Column } from '../../../../components/ui/DataTable';
import { FadeIn } from '../../../../components/motion';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { AppText } from '../../../../../components/ui/AppText';
import { colors } from '../../../../../theme/tokens';
import type {
  DrivingCoachData,
  CoachDriveScore,
} from '../../../../api/hooks/useDriving';

// ─── i18n fallback ────────────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy (or the key itself when no default is supplied, mirroring i18next), with
// `{{name}}` interpolation so every i18n key + interpolation intent survives.
type TParams = Record<string, string | number>;
type TFunc = (key: string, defaultValue?: string, params?: TParams) => string;

function useTranslation(): { t: TFunc } {
  return {
    t: (key, defaultValue, params) => {
      const base = defaultValue ?? key;
      if (!params) {
        return base;
      }
      return base.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        params[name] != null ? String(params[name]) : `{{${name}}}`,
      );
    },
  };
}

// ─── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber) ────
// Locale-aware formatting matching the web helper: nullish/non-finite input
// coerces to 0, a bad locale falls back to en-US. The web default precision is
// 2; every surviving call site uses that default.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

// ─── Inlined `@/lib/dateFormat` (formatDateShort) ─────────────
// Short "Mon D" date: nullish/invalid -> "—". Mirrors the web helper
// (toLocaleDateString with month: 'short', day: 'numeric', browser locale) with
// a month-name fallback for runtimes whose Intl lacks date formatting.
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function formatDateShort(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
}

// ─── Decorative glyph (lucide icon substitute) ────────────────
// The lucide icons are decorative; the adjacent label always carries meaning,
// so the glyph is hidden from assistive tech.
function Glyph({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no"
      style={style}
    >
      {children}
    </AppText>
  );
}

// ─── EmptyState (web @/components/feedback EmptyState) ─────────
// Mirrors the web public API surface used here (message required; title/icon
// optional). The web `action`/`actionTo` CTAs are unused by every call site in
// this component (all are the documented no-action transient empty state).
function EmptyState({
  icon,
  title,
  message,
}: {
  icon?: ReactNode;
  title?: string;
  message: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      {title ? (
        <AppText style={styles.emptyStateTitle} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyStateMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ─── StatCard (web @/components/data-display StatCard) ─────────
interface StatTrend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  positive?: boolean;
}

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: StatTrend;
  sublabel?: string;
}

function trendColor(trend: StatTrend): string {
  if (trend.positive) {
    return colors.success;
  }
  if (trend.direction === 'flat') {
    return colors.textMuted;
  }
  return colors.danger;
}

function StatCard({
  label,
  value,
  unit,
  icon,
  trend,
  sublabel,
}: StatCardProps) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardHeader}>
        <AppText
          numberOfLines={1}
          style={styles.statCardLabel}
          tone="muted"
          variant="caption"
        >
          {label}
        </AppText>
        {icon}
      </View>
      <View style={styles.statCardValueRow}>
        <AppText style={styles.statCardValue} weight="bold">
          {String(value)}
        </AppText>
        {unit ? (
          <AppText style={styles.statCardUnit} tone="muted">
            {unit}
          </AppText>
        ) : null}
      </View>
      {trend ? (
        <AppText style={[styles.statCardTrend, { color: trendColor(trend) }]}>
          {`${
            trend.direction === 'up'
              ? '↑'
              : trend.direction === 'down'
              ? '↓'
              : '—'
          } ${trend.value}`}
        </AppText>
      ) : null}
      {sublabel ? (
        <AppText style={styles.statCardSublabel} tone="muted" variant="caption">
          {sublabel}
        </AppText>
      ) : null}
    </View>
  );
}

// ─── Style-breakdown colour maps (web neon + toned hexes) ─────
type DriveStyle = 'efficient' | 'moderate' | 'aggressive';

// Segmented-bar fills: web bg-neon-green / bg-neon-amber / bg-red-500.
const STYLE_BAR_COLOR: Record<DriveStyle, string> = {
  efficient: '#10b981',
  moderate: '#f59e0b',
  aggressive: '#ef4444',
};

// Legend rows: dot = web bg-neon-* ; text = web toned text-emerald-300 /
// text-amber-300 / text-red-400.
const STYLE_LEGEND: readonly { key: DriveStyle; dot: string; text: string }[] =
  [
    { key: 'efficient', dot: '#10b981', text: '#6ee7b7' },
    { key: 'moderate', dot: '#f59e0b', text: '#fcd34d' },
    { key: 'aggressive', dot: '#ef4444', text: '#f87171' },
  ] as const;

interface DrivingCoachSectionProps {
  coachData: DrivingCoachData | undefined;
}

export default function DrivingCoachSection({
  coachData,
}: DrivingCoachSectionProps) {
  const { t } = useTranslation();

  const coachColumns: Column<CoachDriveScore>[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('Date'),
        render: (r: CoachDriveScore) => formatDateShort(r.date),
        sortable: true,
      },
      {
        key: 'score',
        header: t('Score'),
        sortable: true,
        render: (r: CoachDriveScore) => (
          <Badge
            variant={
              r.score >= 75 ? 'success' : r.score >= 50 ? 'warning' : 'danger'
            }
            size="sm"
          >
            {r.score}
          </Badge>
        ),
      },
      {
        key: 'style',
        header: t('Style'),
        sortable: true,
        render: (r: CoachDriveScore) => (
          <Badge
            variant={
              r.style === 'efficient'
                ? 'success'
                : r.style === 'moderate'
                ? 'warning'
                : 'danger'
            }
            size="sm"
          >
            {r.style}
          </Badge>
        ),
      },
      {
        key: 'efficiency',
        header: t('Wh/km'),
        render: (r: CoachDriveScore) => fmtNumber(r.efficiency),
        sortable: true,
      },
      {
        key: 'distance',
        header: t('Distance'),
        render: (r: CoachDriveScore) => `${fmtNumber(r.distance)} km`,
        sortable: true,
      },
    ],
    [t],
  );

  const patterns = [
    {
      label: t('dynamics.coach.hardAccel', 'Hard Acceleration'),
      value: coachData?.patterns.hard_accel_pct ?? 0,
      lo: 20,
      hi: 40,
    },
    {
      label: t('dynamics.coach.hardBrake', 'Hard Braking'),
      value: coachData?.patterns.hard_brake_pct ?? 0,
      lo: 15,
      hi: 30,
    },
    {
      label: t('dynamics.coach.highway', 'Highway Driving'),
      value: coachData?.patterns.highway_pct ?? 0,
      lo: 50,
      hi: 70,
    },
    {
      label: t('dynamics.coach.shortTrips', 'Short Trips (<5 km)'),
      value: coachData?.patterns.short_trip_pct ?? 0,
      lo: 30,
      hi: 50,
    },
    {
      label: t('dynamics.coach.coldStarts', 'Cold Starts'),
      value: coachData?.patterns.cold_start_pct ?? 0,
      lo: 15,
      hi: 30,
    },
  ];

  const overallScore = coachData?.overall_score ?? 0;
  const gaugeColor =
    overallScore >= 75 ? '#22c55e' : overallScore >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <View style={styles.root}>
      {/* Section heading */}
      <FadeIn delay={0.42}>
        <View style={styles.sectionHeading}>
          <AppText style={styles.sectionTitle} weight="semibold">
            {t('dynamics.coach.title', 'Driving Coach')}
          </AppText>
        </View>
      </FadeIn>

      {/* Score + Style + Efficiency */}
      <View style={styles.threePanelGrid}>
        <FadeIn delay={0.43}>
          <GlassPanel style={[styles.panel, styles.panelCenter]}>
            <RadialGauge
              value={overallScore}
              max={100}
              label={t('dynamics.coach.overallScore', 'Driving Score')}
              color={gaugeColor}
              size={160}
            />
            <AppText style={styles.drivesAnalyzed} tone="secondary">
              {t('dynamics.coach.drivesAnalyzed', '{{count}} drives analyzed', {
                count: coachData?.total_drives_analyzed ?? 0,
              })}
            </AppText>
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.44}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelTitle} weight="semibold">
              {t('dynamics.coach.styleBreakdown', 'Style Breakdown')}
            </AppText>
            {coachData && coachData.total_drives_analyzed > 0 ? (
              <>
                <View style={styles.breakdownBar}>
                  {(['efficient', 'moderate', 'aggressive'] as const).map(
                    style => {
                      const count = coachData.style_breakdown[style] ?? 0;
                      const pct =
                        (count / coachData.total_drives_analyzed) * 100;
                      if (pct <= 0) {
                        return null;
                      }
                      return (
                        <View
                          key={style}
                          accessibilityLabel={`${style}: ${count}`}
                          style={{
                            backgroundColor: STYLE_BAR_COLOR[style],
                            width: `${pct}%`,
                          }}
                        />
                      );
                    },
                  )}
                </View>
                <View style={styles.legendStack}>
                  {STYLE_LEGEND.map(({ key, dot, text }) => (
                    <View key={key} style={styles.legendRow}>
                      <View style={styles.legendLeft}>
                        <View
                          style={[styles.legendDot, { backgroundColor: dot }]}
                        />
                        <AppText style={styles.legendLabel} tone="secondary">
                          {t(`dynamics.coach.style.${key}`, key)}
                        </AppText>
                      </View>
                      <AppText style={[styles.legendValue, { color: text }]}>
                        {coachData.style_breakdown[key] ?? 0}
                      </AppText>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <EmptyState
                message={t(
                  'dynamics.coach.noData',
                  'Drive more to see your style breakdown.',
                )}
              />
            )}
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.45}>
          <GlassPanel style={[styles.panel, styles.panelGap]}>
            <StatCard
              label={t('dynamics.coach.avgEfficiency', 'Avg Efficiency')}
              value={`${fmtNumber(coachData?.efficiency_wh_km ?? 0)} Wh/km`}
              icon={<Glyph style={styles.statGlyph}>⚡</Glyph>}
            />
            <StatCard
              label={t('dynamics.coach.bestEfficiency', 'Best Efficiency')}
              value={`${fmtNumber(
                coachData?.best_efficiency_wh_km ?? 0,
              )} Wh/km`}
              icon={<Glyph style={styles.statGlyph}>🛡</Glyph>}
            />
          </GlassPanel>
        </FadeIn>
      </View>

      {/* Weekly Trend */}
      <FadeIn delay={0.46}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('dynamics.coach.weeklyTrend', 'Weekly Score Trend')}
          </AppText>
          {(coachData?.weekly_trend ?? []).length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={coachData?.weekly_trend ?? []}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.05)"
                />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="score"
                  stroke="#22c55e"
                  dot={{ fill: '#22c55e', r: 3 }}
                  name={t('Score')}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              message={t(
                'dynamics.coach.needWeeks',
                'Need at least 2 weeks of data for trend analysis.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Pattern Indicators */}
      <FadeIn delay={0.47}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('dynamics.coach.patterns', 'Driving Patterns')}
          </AppText>
          <View style={styles.patternStack}>
            {patterns.map(p => {
              const valueColor =
                p.value <= p.lo
                  ? '#6ee7b7'
                  : p.value <= p.hi
                  ? '#fcd34d'
                  : '#f87171';
              const fillColor =
                p.value <= p.lo
                  ? '#10b981'
                  : p.value <= p.hi
                  ? '#f59e0b'
                  : '#ef4444';
              return (
                <View key={p.label} style={styles.patternRow}>
                  <View style={styles.patternRowBetween}>
                    <AppText style={styles.patternLabel} tone="secondary">
                      {p.label}
                    </AppText>
                    <AppText
                      style={[styles.patternValue, { color: valueColor }]}
                    >
                      {`${fmtNumber(p.value)}%`}
                    </AppText>
                  </View>
                  <View style={styles.patternTrack}>
                    <View
                      style={[
                        styles.patternFill,
                        {
                          backgroundColor: fillColor,
                          width: `${Math.min(100, p.value)}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </GlassPanel>
      </FadeIn>

      {/* Recommendations */}
      <FadeIn delay={0.48}>
        <GlassPanel style={styles.panel}>
          <View style={styles.recHeader}>
            <Glyph style={styles.recIcon}>💡</Glyph>
            <AppText style={styles.panelTitleInline} weight="semibold">
              {t('dynamics.coach.recommendations', 'Recommendations')}
            </AppText>
          </View>
          {(coachData?.recommendations ?? []).length > 0 ? (
            <View style={styles.recStack}>
              {(coachData?.recommendations ?? []).map((rec, i) => (
                <View key={i} style={styles.recRow}>
                  <Badge
                    variant={
                      rec.impact === 'high'
                        ? 'danger'
                        : rec.impact === 'medium'
                        ? 'warning'
                        : 'success'
                    }
                    size="sm"
                    style={styles.recBadge}
                  >
                    {rec.impact}
                  </Badge>
                  <AppText style={styles.recTip} tone="secondary">
                    {rec.tip}
                  </AppText>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              message={t(
                'dynamics.coach.noRecs',
                'Recommendations will appear after more drives.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Per-Drive Scores */}
      <FadeIn delay={0.49}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('dynamics.coach.perDriveScores', 'Per-Drive Scores')}
          </AppText>
          {(coachData?.per_drive_scores ?? []).length > 0 ? (
            <DataTable
              tableId="driving:coach-per-drive"
              columns={coachColumns}
              data={coachData?.per_drive_scores ?? []}
              keyExtractor={(row: CoachDriveScore) => String(row.drive_id)}
              compact
              pagination
              emptyMessage={t('dynamics.coach.noDrives', 'No drives found.')}
            />
          ) : (
            <EmptyState
              message={t(
                'dynamics.coach.noDrives',
                'Drive data will appear after your first trip.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  breakdownBar: {
    borderRadius: 9999, // rounded-full
    flexDirection: 'row',
    height: 16, // h-4
    marginBottom: 16, // mb-4
    overflow: 'hidden',
  },
  drivesAnalyzed: {
    fontSize: 12, // text-xs
    marginTop: 8, // mt-2
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 32, // py-16 condensed for a panel-embedded empty state
  },
  emptyStateIcon: {
    marginBottom: 8,
  },
  emptyStateMessage: {
    fontSize: 14, // text-bodySm
    maxWidth: 360, // max-w-md
    textAlign: 'center',
  },
  emptyStateTitle: {
    fontSize: 16,
    marginBottom: 4,
  },
  legendDot: {
    borderRadius: 9999, // rounded-full
    height: 8, // h-2
    width: 8, // w-2
  },
  legendLabel: {
    fontSize: 12, // text-xs
    textTransform: 'capitalize',
  },
  legendLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendStack: {
    gap: 8, // space-y-2
  },
  legendValue: {
    fontSize: 12, // text-xs
    fontVariant: ['tabular-nums'],
    fontWeight: '700', // font-bold
  },
  panel: {
    padding: 24, // p-6
  },
  panelCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelGap: {
    gap: 12, // space-y-3
  },
  panelTitle: {
    fontSize: 14, // text-sm
    marginBottom: 16, // mb-4
  },
  panelTitleInline: {
    fontSize: 14, // text-sm
  },
  patternFill: {
    borderRadius: 9999, // rounded-full
    height: '100%',
  },
  patternLabel: {
    flexShrink: 1,
    fontSize: 12, // text-xs
  },
  patternRow: {
    gap: 4, // space-y-1
  },
  patternRowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  patternStack: {
    gap: 12, // space-y-3
  },
  patternTrack: {
    backgroundColor: 'rgba(255,255,255,0.06)', // bg-white/[0.06]
    borderRadius: 9999, // rounded-full
    height: 6, // h-1.5
    overflow: 'hidden',
  },
  patternValue: {
    fontSize: 12, // text-xs
    fontVariant: ['tabular-nums'],
    fontWeight: '700', // font-bold
  },
  recBadge: {
    flexShrink: 0, // shrink-0
    marginTop: 2, // mt-0.5
  },
  recHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
    marginBottom: 16, // mb-4
  },
  recIcon: {
    color: '#f59e0b', // text-neon-amber
    fontSize: 14,
  },
  recRow: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.03)', // bg-white/[0.03]
    borderColor: 'rgba(255,255,255,0.06)', // border-white/[0.06]
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12, // gap-3
    padding: 12, // p-3
  },
  recStack: {
    gap: 12, // space-y-3
  },
  recTip: {
    flexShrink: 1,
    fontSize: 14, // text-sm
  },
  root: {
    gap: 16,
  },
  sectionHeading: {
    marginBottom: 8, // mb-2
    marginTop: 16, // mt-4
  },
  sectionTitle: {
    fontSize: 18, // text-lg
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4, // gap-1
    padding: 16,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCardLabel: {
    flexShrink: 1,
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
  statCardSublabel: {
    fontSize: 12, // text-xs
  },
  statCardTrend: {
    fontSize: 12, // text-xs
  },
  statCardUnit: {
    fontSize: 14, // text-sm
  },
  statCardValue: {
    fontSize: 24, // text-2xl
  },
  statCardValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4, // gap-1
  },
  statGlyph: {
    fontSize: 16, // h-4 w-4 icon footprint
  },
  threePanelGrid: {
    gap: 16, // grid gap-4
  },
});
