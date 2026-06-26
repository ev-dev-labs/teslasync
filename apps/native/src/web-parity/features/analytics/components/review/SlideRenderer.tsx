// Native parity port of
// web/src/features/analytics/components/review/SlideRenderer.tsx.
//
// The web source is the "Year in Review" slide dispatcher: a `switch (slide.type)`
// that picks one of ten slide components (TitleSlide, StatHeroSlide, StatChartSlide,
// DriveHighlightSlide, ChargingBreakdownSlide, SavingsSlide, EnvironmentSlide,
// PatternsSlide, ComparisonsSlide, SummarySlide), wrapped in framer-motion's
// `<AnimatePresence mode="wait">` + a `motion.div` keyed by `slideIndex` that runs a
// horizontal slide/fade enter-exit and paints a `bg-gradient-to-br ${slide.bg}`
// background.
//
// None of the ten sibling slide files (nor `./slides`) have a native port yet — the
// `review/` directory is otherwise empty and the conversion loop reaches this
// dispatcher first. Per the established repo precedent (TeslaOrdersPage, the admin
// pages, OverviewVehicleComparison are all self-contained single-file native ports
// that inline their not-yet-ported sub-pieces on React Native primitives), this port
// keeps the full dispatch contract and inlines each slide's body natively rather than
// importing modules that do not exist (which would break `tsc`). Every slide renders
// its real `YearReview` data — no stubs.
//
// Platform dependency swaps (no DOM, no framer-motion, no Recharts, no lucide, no web
// UI, contract rule 4):
//   * `<AnimatePresence>` + `<motion.div key={slideIndex} initial/animate/exit ...>` ->
//     a keyed `<View>` painted with a solid background derived from the tailwind
//     `from-{color}-900` stop of `slide.bg`. The slide/fade enter-exit choreography
//     carries no behavioural contract and there is no native gradient/animation
//     primitive in this app's deps, so it is a native-safe static layout (the same
//     precedent the sibling FadeIn->View ports set). `key={slideIndex}` is preserved.
//   * `<AnimatedNumber value decimals prefix suffix>` (@/components/data-display) is
//     not ported; its end state is `{prefix}{fmtNumber(value,decimals)}{suffix}`, so a
//     static formatted value reproduces the visible result exactly.
//   * Recharts `<BarChart>` (StatChart monthly drives) and `<PieChart>` (ChargingBreakdown
//     mix) -> native proportional `MeterBar` lists, following the OverviewVehicleComparison
//     native-chart precedent. All underlying data math is byte-for-byte identical.
//   * lucide glyphs -> dropped where purely decorative (DriveHighlight/Savings tiny
//     accents), `->` text for the route arrow, and the existing `SemanticIcon`
//     (calendar/clock for Patterns cards; vehicle/bolt/charger/leaf for the Summary
//     rows) where the icon is structural.
//   * `useTranslation` (react-i18next) -> an inline `t(key, fallback | {..vars, defaultValue})`
//     that returns the English fallback/defaultValue and reproduces i18next `{{var}}`
//     interpolation. Every key + fallback the slides used is preserved verbatim.
//   * `useUnits().unitPrefs.distance` (@/hooks/useUnits) -> the web default 'km' (no
//     native settings store yet); `convertDistanceFromSI` (@/lib/unitConversion) and
//     `fmtNumber` (@/lib/numberFormat) -> behaviour-identical inlines (METERS_PER_KM=1000
//     / METERS_PER_MILE=1609.344; en-US locale grouping, NaN/Infinity -> 0).
//   * `@/lib/cn` (only joined the gradient classes) -> dropped.
//   * `SlideDefinition` (type-only from ./slides, not ported) -> an identical local
//     interface `{ type: string; bg: string; field?: string }`.
//
// `YearReview` / `YearReviewDriveHighlight` / `YearReviewComparison` are the ported
// web-parity api/types; every `data.total_distance_km` / `drive.efficiency_wh_km` /
// `item.emoji` access reads identically to the web source.

import React from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type TextStyle,
} from 'react-native';

import { SemanticIcon, type SemanticIconName } from '../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../../theme/tokens';
import type {
  YearReview,
  YearReviewComparison,
  YearReviewDriveHighlight,
} from '../../../../api/types';

// Mirror of ./slides `SlideDefinition` (type-only import; ./slides not ported yet).
interface SlideDefinition {
  type: string;
  bg: string;
  field?: string;
}

interface Props {
  slideIndex: number;
  slide: SlideDefinition;
  data: YearReview;
}

// ---------------------------------------------------------------------------
// Native-safe inlines for not-yet-ported web dependencies.
// ---------------------------------------------------------------------------

const KM_PER_MILE = 1.609344;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

type DistanceUnitPref = 'km' | 'mi';

// Web read `unitPrefs.distance` from useUnits(); with no native settings store the
// resolved default is 'km' (the web default when no user settings are loaded).
const NATIVE_DISTANCE_UNIT: DistanceUnitPref = 'km';

type TVars = Record<string, string | number>;

// Web `t` from react-i18next. Native parity has no i18n runtime, so the English
// fallback / defaultValue is returned, reproducing i18next `{{var}}` interpolation.
function t(_key: string, opts: string | (TVars & { defaultValue: string })): string {
  if (typeof opts === 'string') {
    return opts;
  }
  const { defaultValue, ...vars } = opts;
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = (vars as TVars)[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

// Parity for @/lib/unitConversion `convertDistanceFromSI(meters, to)`.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// Parity for @/lib/numberFormat `fmtNumber(v, decimals)`: en-US locale-grouped,
// NaN/Infinity coerced to 0 (web safeNumber) — the AnimatedNumber end-state.
function fmtNumber(value: number, decimals: number): string {
  const n = Number.isFinite(value) ? value : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) {
    return 0;
  }
  return Math.max(0, Math.min(100, pct));
}

// Solid background derived from the tailwind `from-{color}-900` stop of `slide.bg`
// (the gradient's dominant tone) — the native stand-in for `bg-gradient-to-br`.
const BG_900: Record<string, string> = {
  blue: '#1e3a8a',
  indigo: '#312e81',
  slate: '#0f172a',
  emerald: '#064e3b',
  green: '#14532d',
  teal: '#134e4a',
  purple: '#581c87',
  violet: '#4c1d95',
  amber: '#78350f',
  orange: '#7c2d12',
  yellow: '#713f12',
  cyan: '#164e63',
  sky: '#0c4a6e',
  red: '#7f1d1d',
  pink: '#831843',
  lime: '#365314',
  rose: '#881337',
  fuchsia: '#701a75',
};

function backgroundFromSlideClass(bg: string): string {
  const match = /from-([a-z]+)-900/.exec(bg);
  if (match && BG_900[match[1]]) {
    return BG_900[match[1]];
  }
  return colors.background;
}

// Native-chart bar colours (web series colours preserved).
const VIOLET_BAR = 'rgba(167, 139, 250, 0.7)';
const CHARGE_COLORS = ['#f59e0b', '#3b82f6', '#6b7280'];
const RED_BAR = 'rgba(248, 113, 113, 0.6)';
const EMERALD_BAR = 'rgba(52, 211, 153, 0.6)';
const EMERALD_TEXT = '#34d399';
const GREEN_TEXT = '#4ade80';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------------------------------------------------------------------------
// Shared presentational primitives (the centred-hero vocabulary every slide uses).
// ---------------------------------------------------------------------------

// Web slide root: `flex flex-col items-center justify-center h-full px-8 text-center`.
function SlideShell({ children }: { children: React.ReactNode }) {
  return <View style={styles.shell}>{children}</View>;
}

function BigEmoji({ children }: { children: string }) {
  return <AppText style={styles.bigEmoji}>{children}</AppText>;
}

function HeroNumber({ text, color }: { text: string; color?: string }) {
  return (
    <AppText weight="bold" style={[styles.hero, color ? ({ color } as TextStyle) : null]}>
      {text}
    </AppText>
  );
}

function MeterBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={styles.track}>
      <View
        style={[styles.fill, { width: `${clampPct(pct)}%` as DimensionValue, backgroundColor: color }]}
      />
    </View>
  );
}

function Swatch({ color }: { color: string }) {
  return <View style={[styles.swatch, { backgroundColor: color }]} />;
}

// ---------------------------------------------------------------------------
// Slide bodies (native rebuilds of the ten web slide components).
// ---------------------------------------------------------------------------

function TitleSlide({ data }: { data: YearReview }) {
  return (
    <SlideShell>
      <BigEmoji>🚗</BigEmoji>
      <HeroNumber text={fmtNumber(data.year, 0)} />
      <AppText tone="secondary" style={styles.subtitle}>
        {t('yearReview.title', 'Year in Review')}
      </AppText>
      <AppText tone="secondary" style={styles.bodyLg}>
        {data.vehicle.display_name}
      </AppText>
    </SlideShell>
  );
}

interface StatConfig {
  emoji: string;
  value: number;
  decimals: number;
  unit: string;
  comparison: string;
}

function getStatConfig(data: YearReview, field: string, distanceUnit: DistanceUnitPref): StatConfig {
  switch (field) {
    case 'distance': {
      // backend `total_distance_km` is SI km; convert via meter floor.
      const dist = convertDistanceFromSI(data.total_distance_km * 1000, distanceUnit);
      const earthLaps = data.total_distance_km / 40075;
      return {
        emoji: '🛣️',
        value: dist,
        decimals: 0,
        unit: distanceUnit,
        comparison:
          earthLaps >= 0.01
            ? t('yearReview.distanceComparison', {
                percent: fmtNumber(earthLaps * 100, 1),
                defaultValue: "That's {{percent}}% around the Earth!",
              })
            : t('yearReview.distanceSmall', 'Every kilometer counts!'),
      };
    }
    case 'energy':
      return {
        emoji: '⚡',
        value: data.total_energy_kwh,
        decimals: 0,
        unit: t('yearReview.energyUnit', 'kWh charged'),
        comparison: t('yearReview.energyComparison', {
          days: Math.round(data.total_energy_kwh / 30),
          defaultValue: 'Enough to power a home for {{days}} days',
        }),
      };
    default:
      return { emoji: '📊', value: 0, decimals: 0, unit: '', comparison: '' };
  }
}

function StatHeroSlide({ data, field }: { data: YearReview; field: string }) {
  const distanceUnit = NATIVE_DISTANCE_UNIT;
  const config = getStatConfig(data, field, distanceUnit);

  return (
    <SlideShell>
      <BigEmoji>{config.emoji}</BigEmoji>
      <HeroNumber text={fmtNumber(config.value, config.decimals)} />
      <AppText tone="secondary" style={styles.subtitle}>
        {config.unit}
      </AppText>
      <AppText tone="muted" style={styles.comparison}>
        {config.comparison}
      </AppText>
    </SlideShell>
  );
}

function StatChartSlide({ data }: { data: YearReview }) {
  const chartData = (data.monthly_stats ?? []).map((m) => ({
    name: MONTH_LABELS[m.month - 1] ?? `M${m.month}`,
    drives: m.drives,
  }));
  const maxDrives = Math.max(...chartData.map((d) => d.drives), 1);

  return (
    <SlideShell>
      <BigEmoji>🗓️</BigEmoji>
      <View style={styles.inlineBaseline}>
        <HeroNumber text={fmtNumber(data.total_drives, 0)} />
        <AppText tone="secondary" style={styles.subtitle}>
          {t('yearReview.drives', 'drives')}
        </AppText>
      </View>
      <AppText tone="muted" style={styles.caption}>
        {t('yearReview.avgPerWeek', {
          count: fmtNumber(data.avg_drives_per_week, 1),
          defaultValue: '{{count}} drives per week on average',
        })}
      </AppText>
      <View style={styles.chartBlock}>
        {chartData.map((d) => (
          <View key={d.name} style={styles.chartRow}>
            <AppText variant="caption" tone="muted" style={styles.monthLabel}>
              {d.name}
            </AppText>
            <View style={styles.chartBarWrap}>
              <MeterBar pct={(d.drives / maxDrives) * 100} color={VIOLET_BAR} />
            </View>
            <AppText variant="caption" tone="secondary" style={styles.chartValue}>
              {fmtNumber(d.drives, 0)}
            </AppText>
          </View>
        ))}
      </View>
    </SlideShell>
  );
}

function DriveHighlightSlide({
  drive,
  label,
  emoji,
}: {
  drive: YearReviewDriveHighlight | null;
  label: string;
  emoji: string;
}) {
  const distanceUnit = NATIVE_DISTANCE_UNIT;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  if (!drive) {
    return (
      <SlideShell>
        <BigEmoji>{emoji}</BigEmoji>
        <AppText tone="secondary" style={styles.subtitle}>
          {t('yearReview.noDriveData', 'No drive data for this year')}
        </AppText>
      </SlideShell>
    );
  }

  const hours = Math.floor(drive.duration_min / 60);
  const mins = drive.duration_min % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  // backend `distance_km` is SI km; `efficiency_wh_km` is SI Wh/km.
  const distDisplay = convertDistanceFromSI(drive.distance_km * 1000, distanceUnit);
  const effDisplay = distanceUnit === 'mi' ? drive.efficiency_wh_km * KM_PER_MILE : drive.efficiency_wh_km;

  return (
    <SlideShell>
      <BigEmoji>{emoji}</BigEmoji>
      <AppText tone="secondary" style={styles.eyebrow}>
        {label}
      </AppText>

      <GlassPanel style={styles.card}>
        <View style={styles.routeRow}>
          <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.routeText}>
            {drive.start_address || '—'}
          </AppText>
          <AppText variant="caption" tone="muted">
            {'→'}
          </AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.routeText}>
            {drive.end_address || '—'}
          </AppText>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCell}>
            <AppText weight="bold" style={styles.statValue}>
              {fmtNumber(Math.round(distDisplay), 0)}
            </AppText>
            <AppText variant="caption" tone="muted">
              {distanceUnit}
            </AppText>
          </View>
          <View style={styles.statCell}>
            <AppText weight="bold" style={styles.statValue}>
              {durationStr}
            </AppText>
            <AppText variant="caption" tone="muted">
              {t('yearReview.duration', 'duration')}
            </AppText>
          </View>
          <View style={styles.statCell}>
            <AppText weight="bold" style={styles.statValue}>
              {drive.efficiency_wh_km > 0 ? fmtNumber(Math.round(effDisplay), 0) : '—'}
            </AppText>
            <AppText variant="caption" tone="muted">
              {efficiencyUnit}
            </AppText>
          </View>
        </View>

        <AppText variant="caption" tone="muted" style={styles.dateText}>
          {drive.date}
        </AppText>
      </GlassPanel>
    </SlideShell>
  );
}

function ChargingBreakdownSlide({ data }: { data: YearReview }) {
  const chartData = [
    { name: t('yearReview.supercharger', 'Supercharger'), value: data.supercharger_pct },
    { name: t('yearReview.dcFast', 'DC Fast'), value: data.dc_fast_pct },
    { name: t('yearReview.acOther', 'AC / Other'), value: data.ac_other_pct },
  ].filter((d) => d.value > 0);

  return (
    <SlideShell>
      <BigEmoji>🔌</BigEmoji>
      <AppText weight="bold" style={styles.headline}>
        {data.total_charge_sessions} {t('yearReview.chargeSessions', 'charge sessions')}
      </AppText>
      <AppText tone="muted" style={styles.caption}>
        {t('yearReview.avgStartSOC', {
          soc: Math.round(data.avg_charge_start_soc),
          defaultValue: 'Average plug-in at {{soc}}% battery',
        })}
      </AppText>

      <View style={styles.chartBlock}>
        {chartData.map((item, i) => (
          <View key={item.name} style={styles.breakdownRow}>
            <View style={styles.legendLabel}>
              <Swatch color={CHARGE_COLORS[i % CHARGE_COLORS.length]} />
              <AppText variant="caption" tone="secondary">
                {item.name} ({Math.round(item.value)}%)
              </AppText>
            </View>
            <MeterBar pct={item.value} color={CHARGE_COLORS[i % CHARGE_COLORS.length]} />
          </View>
        ))}
      </View>
    </SlideShell>
  );
}

function SavingsSlide({ data }: { data: YearReview }) {
  const gasCostEquiv = data.gas_savings + data.total_charging_cost;
  const electricPct = gasCostEquiv > 0 ? Math.round((data.total_charging_cost / gasCostEquiv) * 100) : 0;

  return (
    <SlideShell>
      <BigEmoji>💰</BigEmoji>
      <AppText tone="secondary" style={styles.eyebrow}>
        {t('yearReview.youSaved', 'You saved')}
      </AppText>
      <HeroNumber text={`$${fmtNumber(data.gas_savings, 0)}`} color={EMERALD_TEXT} />
      <AppText tone="muted" style={styles.caption}>
        {t('yearReview.vsGas', 'vs. driving a gas car')}
      </AppText>

      <View style={styles.barsBlock}>
        <View style={styles.savingsRow}>
          <View style={styles.savingsHead}>
            <AppText variant="caption" tone="secondary">
              {t('yearReview.gasCost', 'Gas would cost')}
            </AppText>
            <AppText variant="caption" weight="semibold" style={styles.redText}>
              ${Math.round(gasCostEquiv)}
            </AppText>
          </View>
          <MeterBar pct={100} color={RED_BAR} />
        </View>

        <View style={styles.savingsRow}>
          <View style={styles.savingsHead}>
            <AppText variant="caption" tone="secondary">
              {t('yearReview.electricCost', 'Electric cost')}
            </AppText>
            <AppText variant="caption" weight="semibold" style={styles.emeraldText}>
              ${Math.round(data.total_charging_cost)}
            </AppText>
          </View>
          <MeterBar pct={electricPct} color={EMERALD_BAR} />
        </View>

        <AppText variant="caption" style={[styles.centerText, styles.emeraldText]}>
          {t('yearReview.savingsNote', {
            cupsOfCoffee: Math.round(data.gas_savings / 5),
            defaultValue: "That's {{cupsOfCoffee}} cups of coffee!",
          })}
        </AppText>
      </View>
    </SlideShell>
  );
}

function EnvironmentSlide({ data }: { data: YearReview }) {
  const treesPlanted = Math.round(data.co2_offset_kg / 21);
  const treeCount = Math.min(treesPlanted, 30);
  const treeIcons = Array.from({ length: treeCount }, (_, i) => i);

  return (
    <SlideShell>
      <BigEmoji>🌍</BigEmoji>
      <AppText tone="secondary" style={styles.eyebrow}>
        {t('yearReview.co2Offset', 'CO₂ offset')}
      </AppText>
      <HeroNumber text={`${fmtNumber(data.co2_offset_kg, 0)} kg`} color={GREEN_TEXT} />
      <AppText tone="muted" style={styles.caption}>
        {t('yearReview.treesEquiv', { count: treesPlanted, defaultValue: 'Like planting {{count}} trees' })}
      </AppText>

      <View style={styles.treeGrid}>
        {treeIcons.map((i) => (
          <AppText key={i} style={styles.treeEmoji}>
            🌳
          </AppText>
        ))}
        {treesPlanted > 30 && (
          <AppText variant="caption" tone="muted" style={styles.treeMore}>
            +{treesPlanted - 30} {t('yearReview.more', 'more')}
          </AppText>
        )}
      </View>
    </SlideShell>
  );
}

function PatternsSlide({ data }: { data: YearReview }) {
  const distanceUnit = NATIVE_DISTANCE_UNIT;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  // backend `avg_distance_per_drive_km` is SI km; `avg_efficiency_wh_km` is SI Wh/km.
  const avgDistDisplay = convertDistanceFromSI(data.avg_distance_per_drive_km * 1000, distanceUnit);
  const avgEffDisplay =
    distanceUnit === 'mi' ? data.avg_efficiency_wh_km * KM_PER_MILE : data.avg_efficiency_wh_km;

  const hourLabel =
    data.most_active_hour >= 12
      ? `${data.most_active_hour === 12 ? 12 : data.most_active_hour - 12} PM`
      : `${data.most_active_hour === 0 ? 12 : data.most_active_hour} AM`;

  return (
    <SlideShell>
      <BigEmoji>📊</BigEmoji>
      <AppText tone="secondary" style={styles.subtitle}>
        {t('yearReview.drivingPatterns', 'Your driving patterns')}
      </AppText>

      <View style={styles.patternBlock}>
        <GlassPanel style={styles.patternCard}>
          <SemanticIcon name="calendar" size="md" decorative />
          <View style={styles.patternText}>
            <AppText variant="caption" tone="muted">
              {t('yearReview.favoriteDay', 'Favorite driving day')}
            </AppText>
            <AppText weight="bold" style={styles.statValue}>
              {data.most_active_day_of_week || '—'}
            </AppText>
          </View>
        </GlassPanel>

        <GlassPanel style={styles.patternCard}>
          <SemanticIcon name="clock" size="md" decorative />
          <View style={styles.patternText}>
            <AppText variant="caption" tone="muted">
              {t('yearReview.peakHour', 'Peak driving hour')}
            </AppText>
            <AppText weight="bold" style={styles.statValue}>
              {hourLabel}
            </AppText>
          </View>
        </GlassPanel>

        <View style={styles.patternStatsRow}>
          <View style={styles.patternStat}>
            <AppText weight="bold" style={styles.patternStatValue}>
              {fmtNumber(data.avg_drives_per_week, 1)}
            </AppText>
            <AppText variant="caption" tone="muted" style={styles.centerText}>
              {t('yearReview.drivesWeek', 'drives/week')}
            </AppText>
          </View>
          <View style={styles.patternStat}>
            <AppText weight="bold" style={styles.patternStatValue}>
              {fmtNumber(Math.round(avgDistDisplay), 0)}
            </AppText>
            <AppText variant="caption" tone="muted" style={styles.centerText}>
              {t('yearReview.distancePerDrive', { unit: distanceUnit, defaultValue: '{{unit}}/drive avg' })}
            </AppText>
          </View>
          <View style={styles.patternStat}>
            <AppText weight="bold" style={styles.patternStatValue}>
              {fmtNumber(Math.round(avgEffDisplay), 0)}
            </AppText>
            <AppText variant="caption" tone="muted" style={styles.centerText}>
              {efficiencyUnit} {t('yearReview.avg', 'avg')}
            </AppText>
          </View>
        </View>
      </View>
    </SlideShell>
  );
}

function ComparisonsSlide({ comparisons }: { comparisons: YearReviewComparison[] }) {
  const items = comparisons ?? [];

  return (
    <SlideShell>
      <AppText tone="secondary" style={styles.subtitle}>
        {t('yearReview.funFacts', 'Fun facts about your year')}
      </AppText>

      <View style={styles.factGrid}>
        {items.map((item) => (
          <GlassPanel key={item.label} style={styles.factCard}>
            <AppText style={styles.factEmoji}>{item.emoji}</AppText>
            <AppText variant="caption" weight="semibold" style={styles.centerText}>
              {item.label}
            </AppText>
            <AppText variant="caption" tone="secondary" style={styles.centerText}>
              {item.value}
            </AppText>
          </GlassPanel>
        ))}
      </View>
    </SlideShell>
  );
}

function SummarySlide({ data }: { data: YearReview }) {
  const distanceUnit = NATIVE_DISTANCE_UNIT;

  const stats: { icon: SemanticIconName; label: string; value: number; decimals: number }[] = [
    { icon: 'vehicle', label: t('yearReview.totalDrives', 'Drives'), value: data.total_drives, decimals: 0 },
    {
      icon: 'vehicle',
      label: distanceUnit,
      // backend `total_distance_km` is SI km; convert via meter floor.
      value: convertDistanceFromSI(data.total_distance_km * 1000, distanceUnit),
      decimals: 0,
    },
    { icon: 'bolt', label: t('yearReview.energyKwh', 'kWh'), value: data.total_energy_kwh, decimals: 0 },
    { icon: 'charger', label: t('yearReview.charges', 'Charges'), value: data.total_charge_sessions, decimals: 0 },
    { icon: 'leaf', label: t('yearReview.co2KgSaved', 'kg CO₂ saved'), value: data.co2_offset_kg, decimals: 0 },
  ];

  return (
    <SlideShell>
      <GlassPanel style={styles.summaryCard}>
        <View style={styles.summaryHead}>
          <View>
            <AppText weight="bold" style={styles.summaryYear}>
              {data.year}
            </AppText>
            <AppText variant="caption" tone="secondary">
              {t('yearReview.title', 'Year in Review')}
            </AppText>
          </View>
          <View style={styles.summaryHeadRight}>
            <AppText variant="caption" weight="semibold">
              {data.vehicle.display_name}
            </AppText>
            <AppText variant="caption" tone="muted">
              {data.vehicle.model}
            </AppText>
          </View>
        </View>

        <View style={styles.summaryStats}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.summaryRow}>
              <SemanticIcon name={stat.icon} size="sm" decorative />
              <AppText weight="bold" style={styles.summaryValue}>
                {fmtNumber(stat.value, stat.decimals)}
              </AppText>
              <AppText variant="caption" tone="secondary">
                {stat.label}
              </AppText>
            </View>
          ))}
        </View>

        {data.gas_savings > 0 && (
          <View style={styles.summaryFooter}>
            <AppText variant="caption" style={[styles.centerText, styles.emeraldText]}>
              💰{' '}
              {t('yearReview.savedSummary', {
                amount: Math.round(data.gas_savings),
                defaultValue: 'Saved ${{amount}} vs. gas',
              })}
            </AppText>
          </View>
        )}

        <AppText variant="caption" tone="muted" style={styles.summaryBrand}>
          TeslaSync • Year in Review
        </AppText>
      </GlassPanel>

      <AppText variant="caption" tone="muted" style={styles.caption}>
        {t('yearReview.screenshot', '📸 Screenshot to share your year!')}
      </AppText>
    </SlideShell>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher (the web `renderSlideContent` switch, ported verbatim).
// ---------------------------------------------------------------------------

function renderSlideContent(slide: SlideDefinition, data: YearReview): React.ReactNode {
  switch (slide.type) {
    case 'title':
      return <TitleSlide data={data} />;

    case 'stat-hero':
      return <StatHeroSlide data={data} field={slide.field ?? 'distance'} />;

    case 'stat-chart':
      return <StatChartSlide data={data} />;

    case 'drive-highlight':
      if (slide.field === 'longest') {
        return (
          <DriveHighlightSlide
            drive={data.longest_drive}
            label={t('yearReview.longestDrive', 'Longest Drive')}
            emoji="🏔️"
          />
        );
      }
      return (
        <DriveHighlightSlide
          drive={data.most_efficient_drive}
          label={t('yearReview.mostEfficient', 'Most Efficient Drive')}
          emoji="🌿"
        />
      );

    case 'charging-breakdown':
      return <ChargingBreakdownSlide data={data} />;

    case 'savings':
      return <SavingsSlide data={data} />;

    case 'environment':
      return <EnvironmentSlide data={data} />;

    case 'patterns':
      return <PatternsSlide data={data} />;

    case 'comparisons':
      return <ComparisonsSlide comparisons={data.comparisons} />;

    case 'summary':
      return <SummarySlide data={data} />;

    default:
      return null;
  }
}

export function SlideRenderer({ slideIndex, slide, data }: Props) {
  return (
    <View key={slideIndex} style={[styles.slide, { backgroundColor: backgroundFromSlideClass(slide.bg) }]}>
      {renderSlideContent(slide, data)}
    </View>
  );
}

const styles = StyleSheet.create({
  slide: {
    flex: 1,
  },
  shell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  bigEmoji: {
    fontSize: 64,
    lineHeight: 76,
    textAlign: 'center',
  },
  hero: {
    fontSize: 56,
    lineHeight: 64,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
  bodyLg: {
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  comparison: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 360,
  },
  eyebrow: {
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  caption: {
    textAlign: 'center',
  },
  headline: {
    fontSize: 24,
    lineHeight: 30,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  inlineBaseline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  centerText: {
    textAlign: 'center',
  },
  // Charts (StatChart bars + ChargingBreakdown bars).
  chartBlock: {
    width: '100%',
    maxWidth: 440,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  monthLabel: {
    width: 34,
  },
  chartBarWrap: {
    flex: 1,
  },
  chartValue: {
    width: 36,
    textAlign: 'right',
  },
  breakdownRow: {
    gap: spacing.xs,
  },
  legendLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  // DriveHighlight card.
  card: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.lg,
    gap: spacing.md,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  routeText: {
    flexShrink: 1,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statValue: {
    fontSize: 22,
    lineHeight: 28,
    color: colors.textPrimary,
  },
  dateText: {
    textAlign: 'center',
  },
  // Savings bars.
  barsBlock: {
    width: '100%',
    maxWidth: 320,
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  savingsRow: {
    gap: spacing.xs,
  },
  savingsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  redText: {
    color: '#f87171',
  },
  emeraldText: {
    color: EMERALD_TEXT,
  },
  // Environment tree grid.
  treeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'flex-end',
    gap: spacing.xs,
    maxWidth: 320,
    marginTop: spacing.sm,
  },
  treeEmoji: {
    fontSize: 24,
    lineHeight: 28,
  },
  treeMore: {
    alignSelf: 'flex-end',
  },
  // Patterns.
  patternBlock: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  patternCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  patternText: {
    gap: spacing.xs,
  },
  patternStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  patternStat: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  patternStatValue: {
    fontSize: 28,
    lineHeight: 34,
    color: colors.textPrimary,
  },
  // Comparisons.
  factGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.md,
    maxWidth: 420,
  },
  factCard: {
    width: '46%',
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  factEmoji: {
    fontSize: 30,
    lineHeight: 36,
  },
  // Summary.
  summaryCard: {
    width: '100%',
    maxWidth: 420,
    padding: spacing.xl,
    gap: spacing.lg,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  summaryHeadRight: {
    alignItems: 'flex-end',
  },
  summaryYear: {
    fontSize: 24,
    lineHeight: 30,
    color: colors.textPrimary,
  },
  summaryStats: {
    gap: spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  summaryValue: {
    fontSize: 20,
    lineHeight: 26,
    color: colors.textPrimary,
    minWidth: 64,
  },
  summaryFooter: {
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  summaryBrand: {
    textAlign: 'center',
  },
});
