// Native parity port of
// web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx.
//
// The "Time-to-Charge Analysis" block of the charging-curve view: a heading +
// description, a 2-up (web: 2-col mobile / 4-col lg) grid of four
// <TimeToChargeCard>s (avg 10→80% min, avg 20→80% min, fastest kWh/h, slowest
// kWh/h), and a yearly-trend chart driven by a useMemo that derives every
// metric from the DC charging sessions.
//
// React Native has no DOM, framer-motion, Recharts, or Tailwind, so the web
// tree is reproduced with native View/AppText layers that preserve the same
// data, copy, units, and proportional intent.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/ui GlassPanel -> the shared native GlassPanel against the
//     theme tokens; every Tailwind className collapses to a StyleSheet entry.
//   - @/components/motion <FadeIn delay={0.25}> is a presentation-only entrance
//     animation with no native equivalent yet, so (following the established
//     BatteryHealthSection / OverviewTab idiom) the tree renders statically in
//     its rest state — visually identical at rest. @/components/motion is not
//     imported.
//   - ./YearlyTrendChart (a Recharts ComposedChart of Bar count + Line
//     avg10to80 + Line avg20to80) is inlined here as a native bar/line
//     breakdown because its native module is not yet a converted target (the
//     same idiom ChargingTab used for HourlyPatternBars / MonthlyTrendBars).
//     Each year row keeps the DC-session count and the two minute averages with
//     proportional bars + a 3-item legend. The source's chart-series CHART_COLORS
//     (0/2/5) and its legend swatch colours (#00f0ff / purple-500 / red-500@0.3)
//     diverge; the unified native stand-in adopts the user-facing legend colours.
//   - isDcSession / avg / durationMinutes import from the already-converted
//     native ./helpers (same directory); convertEnergyFromSI from
//     @/lib/unitConversion is inlined verbatim (kWh = wh/1000) like the converted
//     EnergyFlowPage / FleetComparePage.
//   - ./types TimeToChargeMetrics is inlined because the native ./types module
//     is not yet a converted target (the same idiom native ./helpers used for
//     CurvePoint).
//   - @/lib/numberFormat fmtNumber -> an inlined formatter with the same
//     nullish/NaN -> 0 (safe) and en-US grouping at the web global default
//     precision 2 (the not-yet-ported global locale/precision settings).
//   - react-i18next useTranslation -> a native English-default `t` that keeps
//     every charging.curve.* key verbatim and applies the same {{id}}
//     interpolation the web `t` performs.
//
// No DOM, framer-motion, Recharts, Leaflet, lucide-react, or old web UI
// components are imported.

import React, {useMemo} from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type {ChargingSession} from '../../../../api/types';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {isDcSession, avg, durationMinutes} from './helpers';

/* ─── Inlined type (web ./types.TimeToChargeMetrics) ──────────────────────── */

interface TimeToChargeMetrics {
  avg10to80: number | null;
  avg20to80: number | null;
  fastest: {rate: number; id: number} | null;
  slowest: {rate: number; id: number} | null;
  yearlyTrend: {
    year: string;
    avg10to80: number;
    avg20to80: number;
    count: number;
  }[];
}

/* ─── Native i18n fallback (mirrors i18next default-value + interpolation) ── */

type TVars = Record<string, string | number | null | undefined>;

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every charging.curve.* key verbatim, and applies the same
// {{var}} interpolation the web `t` performs (web uses {{id}}).
function t(_key: string, fallback: string, vars?: TVars): string {
  let out = fallback;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      const value = vars[varKey];
      out = out.split(`{{${varKey}}}`).join(value == null ? '' : String(value));
    }
  }
  return out;
}

/* ─── Numeric helpers (mirror web @/lib/numberFormat + null safety) ───────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safe(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat.fmtNumber. The card values call it without a
// precision, so the web global default (2) + en-US grouping stand in for the
// not-yet-ported global locale/precision settings.
function fmtNumber(v: unknown, decimals = 2): string {
  const n = safe(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

// Mirrors web lib/numberFormat.fmtInt -> fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Inlined unit converter (web @/lib/unitConversion.convertEnergyFromSI) ── */

type EnergyUnitPref = 'Wh' | 'kWh';

// Pure SI -> display converter, verbatim from web lib/unitConversion.
function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

/* ─── Source colours (web ./YearlyTrendChart legend swatches) ─────────────── */

// web ./YearlyTrendChart legend: bg-[#00f0ff] / bg-purple-500 /
// bg-red-500 opacity-30 — the user-facing key for the three series.
const TREND_LINE_10 = '#00f0ff';
const TREND_LINE_20 = '#a855f7';
const TREND_BAR_COUNT = 'rgba(239, 68, 68, 0.3)';

/* ─── Inlined native YearlyTrendChart (web ./YearlyTrendChart) ────────────── */

function ChartLegend({items}: {items: {label: string; color: string}[]}) {
  return (
    <View style={styles.legend}>
      {items.map(item => (
        <View key={item.label} style={styles.legendItem}>
          <View style={[styles.legendDot, {backgroundColor: item.color}]} />
          <AppText variant="caption" tone="secondary">
            {item.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function TrendBar({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string;
  pct: number;
  color: string;
}) {
  const width = `${Math.max(Math.min(pct, 100), 0)}%` as DimensionValue;
  return (
    <View style={styles.trendRow}>
      <AppText variant="caption" tone="muted" style={styles.trendLabel}>
        {label}
      </AppText>
      <View style={styles.track}>
        <View style={[styles.fill, {width, backgroundColor: color}]} />
      </View>
      <AppText variant="caption" weight="semibold" style={styles.trendValue}>
        {value}
      </AppText>
    </View>
  );
}

function YearlyTrendChart({
  yearlyTrend,
}: {
  yearlyTrend: TimeToChargeMetrics['yearlyTrend'];
}) {
  const maxMin =
    yearlyTrend.reduce(
      (m, d) => Math.max(m, safe(d.avg10to80), safe(d.avg20to80)),
      0,
    ) || 1;

  return (
    <GlassPanel style={styles.chartPanel}>
      <AppText weight="semibold" style={styles.chartTitle}>
        {t('charging.curve.yearlyTrend', 'Yearly Charging Speed Trend')}
      </AppText>
      <AppText variant="caption" tone="secondary" style={styles.chartSubtitle}>
        {t(
          'charging.curve.yearlyTrendDesc',
          'Average time-to-charge and session count by year',
        )}
      </AppText>

      {yearlyTrend.length > 0 ? (
        <View style={styles.chartBody}>
          <ChartLegend
            items={[
              {
                label: t('charging.curve.avg10to80Line', '10→80% avg'),
                color: TREND_LINE_10,
              },
              {
                label: t('charging.curve.avg20to80Line', '20→80% avg'),
                color: TREND_LINE_20,
              },
              {
                label: t('charging.curve.dcSessions', 'DC Sessions'),
                color: TREND_BAR_COUNT,
              },
            ]}
          />
          {yearlyTrend.map(d => (
            <View key={d.year} style={styles.yearRow}>
              <View style={styles.yearHead}>
                <AppText variant="caption" weight="semibold">
                  {d.year}
                </AppText>
                <AppText variant="caption" tone="secondary">
                  {`${fmtInt(d.count)} ${t(
                    'charging.curve.dcSessions',
                    'DC Sessions',
                  )}`}
                </AppText>
              </View>
              <TrendBar
                label={t('charging.curve.avg10to80Line', '10→80% avg')}
                value={`${fmtNumber(d.avg10to80, 1)} min`}
                pct={(safe(d.avg10to80) / maxMin) * 100}
                color={TREND_LINE_10}
              />
              <TrendBar
                label={t('charging.curve.avg20to80Line', '20→80% avg')}
                value={`${fmtNumber(d.avg20to80, 1)} min`}
                pct={(safe(d.avg20to80) / maxMin) * 100}
                color={TREND_LINE_20}
              />
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.empty}>
          <AppText tone="muted">{t('common.noData', 'No data available')}</AppText>
        </View>
      )}
    </GlassPanel>
  );
}

/* ─── TimeToChargeCard (web local component) ──────────────────────────────── */

function TimeToChargeCard({
  label,
  value,
  unit,
  subtitle,
  style,
}: {
  label: string;
  value: string | null;
  unit?: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <GlassPanel style={[styles.card, style]}>
      <AppText variant="caption" tone="secondary" style={styles.cardLabel}>
        {label}
      </AppText>
      <AppText weight="semibold" style={styles.cardValue}>
        {value ?? '—'}
        {unit && value ? (
          <AppText tone="secondary" style={styles.cardUnit}>
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
      {subtitle ? (
        <AppText variant="caption" tone="muted" style={styles.cardSubtitle}>
          {subtitle}
        </AppText>
      ) : null}
    </GlassPanel>
  );
}

interface TimeToChargeSectionProps {
  sessions: ChargingSession[];
}

export default function TimeToChargeSection({
  sessions,
}: TimeToChargeSectionProps) {
  const timeToCharge = useMemo((): TimeToChargeMetrics => {
    const empty: TimeToChargeMetrics = {
      avg10to80: null,
      avg20to80: null,
      fastest: null,
      slowest: null,
      yearlyTrend: [],
    };
    if (!sessions.length) {
      return empty;
    }

    const dcSessions = sessions.filter(isDcSession);
    if (!dcSessions.length) {
      return empty;
    }

    const cross10to80 = dcSessions.filter(
      s => s.start_soc_pct <= 10 && (s.end_soc_pct ?? 0) >= 80,
    );
    const cross20to80 = dcSessions.filter(
      s => s.start_soc_pct <= 20 && (s.end_soc_pct ?? 0) >= 80,
    );

    const avg10to80 = cross10to80.length
      ? avg(cross10to80.map(s => durationMinutes(s.started_at, s.ended_at)))
      : null;
    const avg20to80 = cross20to80.length
      ? avg(cross20to80.map(s => durationMinutes(s.started_at, s.ended_at)))
      : null;

    const withRate = dcSessions
      .filter(
        s =>
          durationMinutes(s.started_at, s.ended_at) > 0 &&
          s.total_energy_added_wh > 0,
      )
      .map(s => ({
        id: s.id,
        rate:
          (convertEnergyFromSI(s.total_energy_added_wh, 'kWh') /
            durationMinutes(s.started_at, s.ended_at)) *
          60,
      }));

    const fastest = withRate.length
      ? withRate.reduce((a, b) => (a.rate > b.rate ? a : b))
      : null;
    const slowest = withRate.length
      ? withRate.reduce((a, b) => (a.rate < b.rate ? a : b))
      : null;

    const byYear = new Map<
      string,
      {d10: number[]; d20: number[]; count: number}
    >();
    dcSessions.forEach(s => {
      const year = (s.started_at ?? '').slice(0, 4);
      if (!byYear.has(year)) {
        byYear.set(year, {d10: [], d20: [], count: 0});
      }
      const g = byYear.get(year)!;
      g.count++;
      if (s.start_soc_pct <= 10 && (s.end_soc_pct ?? 0) >= 80) {
        g.d10.push(durationMinutes(s.started_at, s.ended_at));
      }
      if (s.start_soc_pct <= 20 && (s.end_soc_pct ?? 0) >= 80) {
        g.d20.push(durationMinutes(s.started_at, s.ended_at));
      }
    });

    const yearlyTrend = Array.from(byYear.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, {d10, d20, count}]) => ({
        year,
        avg10to80: Math.round(avg(d10) * 10) / 10,
        avg20to80: Math.round(avg(d20) * 10) / 10,
        count,
      }));

    return {avg10to80, avg20to80, fastest, slowest, yearlyTrend};
  }, [sessions]);

  return (
    <View style={styles.section}>
      <AppText weight="semibold" style={styles.heading}>
        {t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}
      </AppText>
      <AppText tone="secondary" style={styles.description}>
        {t(
          'charging.curve.timeToChargeDesc',
          'How long DC sessions take to reach key SOC thresholds',
        )}
      </AppText>

      <View style={styles.grid}>
        <TimeToChargeCard
          style={styles.gridCell}
          label={t('charging.curve.avg10to80', '10% → 80%')}
          value={
            timeToCharge.avg10to80 != null
              ? fmtNumber(timeToCharge.avg10to80)
              : null
          }
          unit="min"
          subtitle={t('charging.curve.avgDuration', 'Avg duration')}
        />
        <TimeToChargeCard
          style={styles.gridCell}
          label={t('charging.curve.avg20to80', '20% → 80%')}
          value={
            timeToCharge.avg20to80 != null
              ? fmtNumber(timeToCharge.avg20to80)
              : null
          }
          unit="min"
          subtitle={t('charging.curve.avgDuration', 'Avg duration')}
        />
        <TimeToChargeCard
          style={styles.gridCell}
          label={t('charging.curve.fastest', 'Fastest Session')}
          value={
            timeToCharge.fastest ? fmtNumber(timeToCharge.fastest.rate) : null
          }
          unit="kWh/h"
          subtitle={
            timeToCharge.fastest
              ? t('charging.curve.sessionId', 'Session #{{id}}', {
                  id: timeToCharge.fastest.id,
                })
              : undefined
          }
        />
        <TimeToChargeCard
          style={styles.gridCell}
          label={t('charging.curve.slowest', 'Slowest Session')}
          value={
            timeToCharge.slowest ? fmtNumber(timeToCharge.slowest.rate) : null
          }
          unit="kWh/h"
          subtitle={
            timeToCharge.slowest
              ? t('charging.curve.sessionId', 'Session #{{id}}', {
                  id: timeToCharge.slowest.id,
                })
              : undefined
          }
        />
      </View>

      <YearlyTrendChart yearlyTrend={timeToCharge.yearlyTrend} />
    </View>
  );
}

TimeToChargeSection.displayName = 'TimeToChargeSection';

const styles = StyleSheet.create({
  card: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 4,
    minWidth: 150,
    padding: 16,
  },
  cardLabel: {
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  cardSubtitle: {
    marginTop: 2,
  },
  cardUnit: {
    fontSize: 14,
  },
  cardValue: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
    marginTop: 4,
  },
  chartBody: {
    gap: 16,
    marginTop: 4,
  },
  chartPanel: {
    gap: 4,
    padding: 16,
  },
  chartSubtitle: {
    marginBottom: 4,
  },
  chartTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  fill: {
    borderRadius: 999,
    height: '100%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  gridCell: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  legendDot: {
    borderRadius: 3,
    height: 8,
    width: 12,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  section: {
    gap: 16,
  },
  track: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flexGrow: 1,
    height: 8,
    overflow: 'hidden',
  },
  trendLabel: {
    width: 86,
  },
  trendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  trendValue: {
    minWidth: 56,
    textAlign: 'right',
  },
  yearHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  yearRow: {
    gap: 8,
  },
});
