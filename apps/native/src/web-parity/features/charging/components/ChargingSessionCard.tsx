// Native parity port of
// web/src/features/charging/components/ChargingSessionCard.tsx.
//
// A single history-style charging-session row: an optional selection checkbox,
// a leading battery-friendly score badge, a primary line (timestamp · duration
// + charger / energy / free / anomaly chips), a charger-location route line, and
// (in the comfortable density) a metrics line (battery delta, peak/avg power,
// duration, cost, cost-per-kWh, and range gained). The whole row links to
// `/charging/{id}`.
//
// React Native has no DOM, react-router <Link>, lucide-react SVGs, Tailwind, the
// `cn` helper, or the web shared ui/data-display components, so the web tree is
// reproduced with native View/Pressable/AppText/GlassPanel layers that preserve
// every state name, API field, unit, i18n key + default, the null-safety guards,
// and the four row slots.
//
// Reused existing native components (imported, not re-inlined):
//   - @/components/data-display RouteDisplay  -> native RouteDisplay parity port.
//   - @/components/ui/Checkbox                -> native Checkbox parity port
//     (web `aria-label` -> native `accessibilityLabel`; onChange(boolean) kept).
//   - @/components/ui GlassPanel / AppText + theme tokens.
//   - ./charging-curve/helpers distanceAddedM -> native helpers parity port
//     (same `start_odometer_m`/`end_odometer_m` delta, >0 else null).
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/data-display HistoryListRow / ScoreBadge / BatteryDelta /
//     InlineMetric / TimeStamp and @/components/ui Badge are inlined as native
//     leaf components because those native modules are not yet converted targets
//     (the same idiom DetailedStatistics used for its ./helpers + formatDuration).
//   - @/lib/chargingAggregation getChargerCategory / durationMinutes / avgPowerW
//     / costPerKwh + ChargerCategory / ChargingAnomaly are inlined verbatim
//     (SI-canonical: Wh, W, minutes, decimal currency).
//   - @/lib/scoreScale numericToGrade + palette/thresholds are inlined as the
//     subset ScoreBadge needs.
//   - @/lib/numberFormat fmtNumber/fmtWithUnit/fmtInt and @/lib/dateFormat
//     formatDurationMinutes are inlined with the same safeNumber/en-US grouping
//     and "—" fallbacks.
//   - @/hooks/useFormatting.formatCurrency is inlined from the native useSettings
//     query (currency_symbol + decimal_precision, '$'/precision-2 fallbacks),
//     matching the web useFormatting contract (DetailedStatistics idiom).
//   - react-i18next useTranslation('charging') -> a native English-default `t`
//     that keeps every key verbatim and interpolates {{value}}/{{from}}/{{to}}.
//   - lucide-react icons map to small native affordances: Sun -> "☀", AlertTriangle
//     -> "⚠", Zap -> "⚡", ChevronRight -> "›", Battery -> a View-drawn cell; the
//     three muted InlineMetric icons (TrendingUp/Plug/Clock) are dropped because
//     their values are self-describing (the ChargingTab inline-icon-drop idiom).
//   - react-router <Link to={href}> has no native router here, so the row is an
//     accessible link Pressable that preserves the href for the navigation layer;
//     the GlassPanel hover `glow` has no native rest equivalent (web glow is
//     hover-only) so it is accepted-for-parity and renders statically.
//
// No DOM, lucide-react, Recharts, Leaflet, framer-motion, or old web UI
// components are imported.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {RouteDisplay} from '../../../components/data-display/RouteDisplay';
import {Checkbox} from '../../../components/ui/Checkbox';
import {useSettings} from '../../../api/hooks/useSettings';
import type {ChargingSession} from '../../../api/types';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {distanceAddedM} from './charging-curve/helpers';

/* ─── Native i18n fallback (mirrors i18next default-value + interpolation) ─── */

// react-i18next is not wired natively; i18next returns the supplied default when
// a key is missing, so this returns the English default while keeping every
// charging.* key verbatim and interpolating {{token}} placeholders.
function t(
  _key: string,
  fallback: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  );
}

const DASH = '—';

/* ─── Numeric helpers (mirror web @/lib/numberFormat) ─────────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat.fmtNumber. en-US grouping + the global default
// precision (2) stand in for the not-yet-ported global locale/precision.
function fmtNumber(v: unknown, decimals = 2): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

// Mirrors web lib/numberFormat.fmtWithUnit -> `${fmtNumber(v, decimals)} ${unit}`.
function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

// Mirrors web lib/numberFormat.fmtInt -> fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Duration helper (web @/lib/dateFormat.formatDurationMinutes) ────────── */

// Mirrors web lib/dateFormat.formatRoundedInt (en-US, 0 fraction digits).
function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Verbatim port of web lib/dateFormat.formatDurationMinutes (re-exported below
// as `formatDuration`): "—" for invalid/negative, optional sub-minute label,
// "{h}h {m}m" / "{m}m" otherwise.
function formatDurationMinutes(
  minutes: number | null | undefined,
  options: {subMinuteLabel?: string} = {},
): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
    return DASH;
  }
  if (options.subMinuteLabel && minutes < 1) {
    return options.subMinuteLabel;
  }
  const h = Math.floor(minutes / 60);
  const m = formatRoundedInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ─── Charging aggregation helpers (web @/lib/chargingAggregation) ────────── */

export type ChargerCategory = 'home' | 'supercharger' | 'dc' | 'unknown';

type ChargingAnomalyKind =
  | 'telemetry_gap'
  | 'cost_zero'
  | 'bad_power'
  | 'expensive'
  | 'trickle';

export interface ChargingAnomaly {
  session: ChargingSession;
  kind: ChargingAnomalyKind;
  /** Short, user-facing message ("Low efficiency", "0 kWh in 1h 16m", …). */
  message: string;
  /** Suggested action label ("Investigate →", "View charger curve →"). */
  actionLabel: string;
}

// Verbatim port of web chargingAggregation.getChargerCategory.
export function getChargerCategory(
  type: string | null | undefined,
): ChargerCategory {
  if (!type) {
    return 'home'; // null type historically means home AC
  }
  const lower = type.toLowerCase();
  if (lower.includes('super') || lower.includes('tpc')) {
    return 'supercharger';
  }
  if (
    lower.includes('dc') ||
    lower.includes('ccs') ||
    lower.includes('chademo') ||
    lower.includes('fast')
  ) {
    return 'dc';
  }
  if (
    lower.includes('home') ||
    lower.includes('ac') ||
    lower.includes('wall')
  ) {
    return 'home';
  }
  return 'unknown';
}

// Verbatim port of web chargingAggregation.durationMinutes.
function durationMinutes(s: ChargingSession): number {
  if (!s.started_at || !s.ended_at) {
    return 0;
  }
  const start = Date.parse(s.started_at);
  const end = Date.parse(s.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return (end - start) / 60_000;
}

// Verbatim port of web chargingAggregation.avgPowerW.
function avgPowerW(s: ChargingSession): number {
  const minutes = durationMinutes(s);
  if (minutes > 0 && s.total_energy_added_wh > 0) {
    return s.total_energy_added_wh / (minutes / 60);
  }
  return s.avg_power_w ?? 0;
}

// Verbatim port of web chargingAggregation.costPerKwh.
function costPerKwh(s: ChargingSession): number | null {
  if (s.total_energy_added_wh <= 0) {
    return null;
  }
  if (s.cost_decimal == null || s.cost_decimal <= 0) {
    return null;
  }
  return s.cost_decimal / (s.total_energy_added_wh / 1000);
}

/* ─── Score scale (subset of web @/lib/scoreScale) ────────────────────────── */

type ScoreGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | typeof DASH;

// Default 0–100 thresholds, highest-first so the first match wins.
const SCORE_THRESHOLDS: ReadonlyArray<{min: number; label: ScoreGrade}> = [
  {min: 90, label: 'A+'},
  {min: 80, label: 'A'},
  {min: 65, label: 'B'},
  {min: 50, label: 'C'},
  {min: 35, label: 'D'},
  {min: 0, label: 'F'},
];

// Mirrors web scoreScale.numericToGrade (label only — colour comes from the
// scoreColorStyles map below, matching the GRADE_PALETTE hex values).
function numericToGrade(score: number | null | undefined): ScoreGrade {
  if (score == null || !Number.isFinite(score)) {
    return DASH;
  }
  for (const tier of SCORE_THRESHOLDS) {
    if (score >= tier.min) {
      return tier.label;
    }
  }
  return 'F';
}

/* ─── Inlined native Badge (web @/components/ui Badge) ─────────────────────── */

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

// rounded-full chip with the web dark-mode variant palette. `leadingGlyph`
// stands in for a lucide icon child (Sun / AlertTriangle).
function Badge({
  variant = 'neutral',
  leadingGlyph,
  text,
}: {
  variant?: BadgeVariant;
  leadingGlyph?: string;
  text: string;
}): React.ReactElement {
  return (
    <View style={[styles.badge, badgeBgStyles[variant]]}>
      {leadingGlyph ? (
        <AppText
          allowFontScaling={false}
          style={[styles.badgeGlyph, badgeTextStyles[variant]]}>
          {leadingGlyph}
        </AppText>
      ) : null}
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]}>
        {text}
      </AppText>
    </View>
  );
}

/* ─── Inlined native ScoreBadge (web @/components/data-display ScoreBadge) ─── */

// The letter IS the badge — colour from the shared grade palette, default `md`.
function ScoreBadge({
  score,
  accessibilityLabel,
}: {
  score: number | null | undefined;
  accessibilityLabel?: string;
}): React.ReactElement {
  const label = numericToGrade(score);
  return (
    <AppText
      accessibilityLabel={accessibilityLabel}
      style={[styles.scoreMd, scoreColorStyles[label]]}>
      {label}
    </AppText>
  );
}

/* ─── Inlined native BatteryDelta (web @/components/data-display) ──────────── */

// Compact battery state-of-charge change: "+60%" emerald / "−1%" amber / "—"
// muted, with a leading View-drawn battery cell (the lucide Battery icon).
function BatteryDelta({
  startPct,
  endPct,
}: {
  startPct: number | null | undefined;
  endPct: number | null | undefined;
}): React.ReactElement {
  const hasData =
    startPct != null &&
    endPct != null &&
    Number.isFinite(startPct) &&
    Number.isFinite(endPct);

  if (!hasData) {
    return (
      <View
        accessibilityLabel={t('battery.delta.unknown', 'Battery delta unknown')}
        accessible
        style={styles.inlineRow}>
        <BatteryGlyph />
        <AppText style={styles.metricMuted}>{DASH}</AppText>
      </View>
    );
  }

  const delta = endPct - startPct;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const magnitude = Math.abs(delta);
  const toneStyle =
    delta > 0
      ? styles.toneEmerald
      : delta < 0
      ? styles.toneAmber
      : styles.metricMuted;
  const visible = delta === 0 ? DASH : `${sign}${magnitude}%`;
  const a11y = t('battery.delta.aria', 'Battery {{from}}% to {{to}}%', {
    from: startPct,
    to: endPct,
  });

  return (
    <View accessibilityLabel={a11y} accessible style={styles.inlineRow}>
      <BatteryGlyph />
      <AppText style={[styles.metricNum, toneStyle]}>{visible}</AppText>
    </View>
  );
}

// View-drawn equivalent of lucide-react's <Battery> (a bordered cell + terminal
// nub), hidden from the a11y tree since the delta text conveys meaning.
function BatteryGlyph(): React.ReactElement {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.batteryWrap}>
      <View style={styles.batteryBody} />
      <View style={styles.batteryNub} />
    </View>
  );
}

/* ─── Inlined native InlineMetric (web @/components/data-display) ──────────── */

// Compact value used in the metric row. The web lucide icon is dropped (the
// value string is self-describing); `valueStyle` carries the optional tone
// (e.g. the emerald cost metric).
function InlineMetric({
  value,
  valueStyle,
}: {
  value: string;
  valueStyle?: StyleProp<TextStyle>;
}): React.ReactElement {
  return (
    <View style={styles.inlineRow}>
      <AppText style={[styles.metricNum, valueStyle]}>{value}</AppText>
    </View>
  );
}

/* ─── Inlined native TimeStamp (web @/components/data-display TimeStamp) ───── */

// Renders the universal "—" for null/unparseable input, otherwise an absolute
// "Apr 4, 2:30 AM"-style datetime. The web hover tooltip + time-format /
// timezone Settings preference are not wired natively, so the body is absolute.
function TimeStamp({
  value,
  style,
}: {
  value: string | number | Date | null | undefined;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  if (value == null) {
    return <AppText style={style}>{DASH}</AppText>;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <AppText style={style}>{DASH}</AppText>;
  }
  let text: string;
  try {
    text = date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    text = date.toISOString();
  }
  return <AppText style={style}>{text}</AppText>;
}

/* ─── Inlined native HistoryListRow (web @/components/data-display) ────────── */

type HistoryListRowGlow = 'cyan' | 'green' | 'purple' | 'none';

interface HistoryListRowProps {
  /** Selection checkbox slot — a sibling of the link so taps don't navigate. */
  checkbox?: ReactNode;
  /** Leading badge slot (score letter) in a fixed-width centred column. */
  leading?: ReactNode;
  /** Required primary line. */
  primary: ReactNode;
  /** Optional second line (RouteDisplay). */
  route?: ReactNode;
  /** Optional third line (metric chips). */
  metrics?: ReactNode;
  /** Navigate to this URL when the row is pressed. */
  href?: string;
  /** Adds the "selected" tint on the panel border. */
  selected?: boolean;
  /**
   * Hover glow colour (web GlassPanel hover-only affordance). Accepted for
   * parity; native has no hover so the row renders statically.
   */
  glow?: HistoryListRowGlow;
  /** Hide the trailing chevron (set when the row isn't navigable). */
  hideChevron?: boolean;
}

// Slot-based row used by Drives / Charging history pages. The web wraps the body
// in a react-router <Link>; native uses an accessible link Pressable that
// preserves the href for the navigation layer.
function HistoryListRow({
  checkbox,
  leading,
  primary,
  route,
  metrics,
  href,
  selected,
  hideChevron,
}: HistoryListRowProps): React.ReactElement {
  const body = (
    <GlassPanel style={[styles.panel, selected ? styles.panelSelected : null]}>
      <View style={styles.innerRow}>
        {leading != null ? (
          <View style={styles.leadingCol}>{leading}</View>
        ) : null}

        <View style={styles.mainCol}>
          <View style={styles.primaryRow}>{primary}</View>
          {route ? <View style={styles.routeRow}>{route}</View> : null}
          {metrics ? <View style={styles.metricsRow}>{metrics}</View> : null}
        </View>

        {!hideChevron ? (
          <AppText allowFontScaling={false} style={styles.chevron}>
            {'\u203A'}
          </AppText>
        ) : null}
      </View>
    </GlassPanel>
  );

  return (
    <View style={styles.row}>
      {checkbox != null ? (
        <View style={styles.checkboxCol}>{checkbox}</View>
      ) : null}
      {href ? (
        <Pressable
          accessibilityRole="link"
          accessibilityValue={{text: href}}
          style={styles.mainFlex}>
          {body}
        </Pressable>
      ) : (
        <View style={styles.mainFlex}>{body}</View>
      )}
    </View>
  );
}

/* ─── ChargingSessionCard ─────────────────────────────────────────────────── */

const ACCENT: Record<
  ChargerCategory,
  'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue'
> = {
  home: 'green',
  supercharger: 'red',
  dc: 'amber',
  unknown: 'cyan',
};

interface ChargingSessionCardProps {
  session: ChargingSession;
  toDistanceDisplay: (km: number) => number;
  distanceUnit: string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
  /** When set, render an inline `⚠ {message}` chip to mark this session
   *  as the one called out in the page-level anomaly summary. */
  anomaly?: ChargingAnomaly;
  /** Show density-aware variant. Compact hides metrics secondary lines. */
  density?: 'comfortable' | 'compact';
}

export function ChargingSessionCard({
  session,
  toDistanceDisplay,
  distanceUnit,
  selected,
  onToggleSelect,
  anomaly,
  density = 'comfortable',
}: ChargingSessionCardProps): React.ReactElement {
  // Mirrors web useFormatting().formatCurrency (settings-derived symbol +
  // precision, '$'/2 fallbacks).
  const {data: settings} = useSettings();
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );

  const cat = getChargerCategory(session.charger_type);
  const chargerLabels: Record<ChargerCategory, string> = {
    supercharger: t('chargerTypes.supercharger', 'Supercharger'),
    dc: t('chargerTypes.dc', 'DC Fast'),
    home: t('chargerTypes.home', 'Home / AC'),
    unknown: t('chargerTypes.unknown', 'Charger'),
  };

  const durationMin = durationMinutes(session);
  const avgRateKw = useMemo(() => {
    const w = avgPowerW(session);
    return w > 0 ? w / 1000 : null;
  }, [session]);
  const cpk = costPerKwh(session);
  const addedM = distanceAddedM(session);
  const milesGained = addedM != null ? toDistanceDisplay(addedM / 1000) : null;
  const energyKwh = (session.total_energy_added_wh ?? 0) / 1000;
  const isFree = session.cost_decimal == null || session.cost_decimal === 0;

  const showCheckbox = typeof onToggleSelect === 'function';

  // Battery-friendly score for the leading badge — derived per session so each
  // row's badge reflects whether the charge stayed in the healthy 30→80 % zone.
  const sessionScore = useMemo(() => {
    const start = session.start_soc_pct;
    const end = session.end_soc_pct;
    if (start == null || end == null) {
      return null;
    }
    let s = 50;
    if (start <= 30) {
      s += 30;
    } else if (start <= 50) {
      s += 15;
    } else if (start <= 70) {
      s += 0;
    } else {
      s -= 10;
    }
    if (end <= 80) {
      s += 20;
    } else if (end <= 90) {
      s += 0;
    } else if (end < 100) {
      s -= 10;
    } else {
      s -= 25;
    }
    return Math.max(0, Math.min(100, s));
  }, [session.start_soc_pct, session.end_soc_pct]);

  const checkbox = showCheckbox ? (
    <Checkbox
      checked={!!selected}
      onChange={next => onToggleSelect?.(session.id, next)}
      accessibilityLabel={t('selectSession', 'Select charging session')}
    />
  ) : undefined;

  const primary = (
    <>
      <TimeStamp value={session.started_at} style={styles.timeStamp} />
      <AppText style={styles.separator}>·</AppText>
      <AppText style={styles.durationText}>
        {formatDurationMinutes(durationMin)}
      </AppText>
      <Badge
        variant={
          cat === 'supercharger'
            ? 'danger'
            : cat === 'dc'
            ? 'warning'
            : 'success'
        }
        text={chargerLabels[cat]}
      />
      {energyKwh > 0 ? (
        <Badge variant="info" text={fmtWithUnit(energyKwh, 'kWh')} />
      ) : null}
      {isFree && energyKwh > 0 ? (
        <Badge variant="success" leadingGlyph="☀" text={t('free', 'Free')} />
      ) : null}
      {anomaly ? (
        <Badge variant="danger" leadingGlyph="⚠" text={anomaly.message} />
      ) : null}
    </>
  );

  // Single endpoint — chargers don't move, so RouteDisplay's explicit-single
  // mode renders just the charger location.
  const route = (
    <RouteDisplay
      start={{
        address: session.start_place,
        lat: session.start_lat,
        lon: session.start_lng,
      }}
    />
  );

  const metrics =
    density === 'compact' ? null : (
      <>
        <BatteryDelta
          startPct={session.start_soc_pct}
          endPct={session.end_soc_pct}
        />
        {session.peak_power_w != null ? (
          <InlineMetric
            value={`${fmtNumber(session.peak_power_w / 1000)} kW peak`}
          />
        ) : null}
        {avgRateKw != null ? (
          <InlineMetric value={`~${fmtNumber(avgRateKw)} kW avg`} />
        ) : null}
        {durationMin > 0 ? (
          <InlineMetric value={formatDurationMinutes(durationMin)} />
        ) : null}
        {typeof session.cost_decimal === 'number' &&
        session.cost_decimal > 0 ? (
          <InlineMetric
            value={formatCurrency(session.cost_decimal)}
            valueStyle={styles.toneEmerald}
          />
        ) : null}
        {cpk != null ? (
          <AppText style={styles.metricMuted}>
            {`(${formatCurrency(cpk, 2)}/kWh)`}
          </AppText>
        ) : null}
        {typeof milesGained === 'number' && milesGained > 0 ? (
          <View style={styles.inlineRow}>
            <AppText allowFontScaling={false} style={styles.zapGlyph}>
              ⚡
            </AppText>
            <AppText style={styles.tonePurple}>
              {`+${fmtInt(milesGained)} ${distanceUnit}`}
            </AppText>
          </View>
        ) : null}
      </>
    );

  return (
    <HistoryListRow
      checkbox={checkbox}
      leading={
        sessionScore != null ? (
          <ScoreBadge
            score={sessionScore}
            accessibilityLabel={t(
              'scoreAria',
              'Battery-friendly score: {{value}}',
              {value: sessionScore},
            )}
          />
        ) : undefined
      }
      primary={primary}
      route={route}
      metrics={metrics}
      href={`/charging/${session.id}`}
      selected={selected}
      glow={ACCENT[cat] === 'red' ? 'cyan' : 'green'}
    />
  );
}

ChargingSessionCard.displayName = 'ChargingSessionCard';

// Parity re-exports (web exported getChargerCategory + formatDurationMinutes as
// formatDuration for sibling charging modules).
export {formatDurationMinutes as formatDuration};

/* ─── Styles ──────────────────────────────────────────────────────────────── */

// Web dark-mode Badge palette (tailwind blue/green/yellow/red/gray-900 + -200).
const badgeBgStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {backgroundColor: '#1e3a8a'},
  success: {backgroundColor: '#14532d'},
  warning: {backgroundColor: '#713f12'},
  danger: {backgroundColor: '#7f1d1d'},
  neutral: {backgroundColor: '#374151'},
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {color: '#bfdbfe'},
  success: {color: '#bbf7d0'},
  warning: {color: '#fef08a'},
  danger: {color: '#fecaca'},
  neutral: {color: '#e5e7eb'},
});

// Web scoreScale GRADE_PALETTE hex values.
const scoreColorStyles = StyleSheet.create<Record<ScoreGrade, TextStyle>>({
  'A+': {color: '#10b981'},
  A: {color: '#10b981'},
  B: {color: '#00f0ff'},
  C: {color: '#f59e0b'},
  D: {color: '#ef4444'},
  F: {color: '#b91c1c'},
  [DASH]: {color: '#6b7280'},
});

const styles = StyleSheet.create({
  // Outer row: optional checkbox sibling + link body (web flex items-stretch).
  row: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 8,
  },
  checkboxCol: {
    justifyContent: 'center',
    paddingLeft: 8,
  },
  mainFlex: {
    flex: 1,
  },
  // GlassPanel p-3 + selected tint (web border-cyan-400/40 ring-cyan-400/20).
  panel: {
    borderRadius: 16,
    padding: 12,
  },
  panelSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  innerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  // Fixed-width centred leading column (web w-9 text-center).
  leadingCol: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    width: 36,
  },
  mainCol: {
    flexShrink: 1,
    minWidth: 0,
    rowGap: 4,
  },
  // flex-wrap items-center gap-2 mb-1.
  primaryRow: {
    alignItems: 'center',
    columnGap: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 4,
  },
  routeRow: {
    flexDirection: 'row',
  },
  // flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums.
  metricsRow: {
    alignItems: 'center',
    columnGap: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 4,
  },
  // ChevronRight h-4 w-4 (web text-gray-700) -> muted "›".
  chevron: {
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: 18,
    lineHeight: 20,
  },
  // TimeStamp className text-sm font-semibold text-[var(--text-primary)].
  timeStamp: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  // text-[10px] text-[var(--text-muted)].
  separator: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  // text-[11px] text-[var(--text-muted)] tabular-nums.
  durationText: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    lineHeight: 15,
  },
  // Badge: inline-flex items-center gap-1 rounded-full px-1.5 py-0.5.
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  badgeGlyph: {
    fontSize: 11,
    lineHeight: 16,
  },
  // ScoreBadge md: text-xl font-bold leading-none tabular-nums.
  scoreMd: {
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    lineHeight: 22,
  },
  // Shared inline icon+value row (web inline-flex items-center gap-1).
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  // InlineMetric value: text-xs text-[var(--text-muted)] tabular-nums.
  metricNum: {
    color: colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
  },
  // Plain muted metric spans (cpk / battery dash) at text-[11px].
  metricMuted: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    lineHeight: 15,
  },
  // text-emerald-300 / text-amber-300 / text-purple-300 (toned-down map).
  toneEmerald: {
    color: '#6ee7b7',
  },
  toneAmber: {
    color: '#fcd34d',
  },
  tonePurple: {
    color: '#d8b4fe',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    lineHeight: 15,
  },
  // Zap (range gained) glyph in purple.
  zapGlyph: {
    color: '#d8b4fe',
    fontSize: 11,
    lineHeight: 15,
  },
  // View-drawn Battery cell (body + terminal nub), muted.
  batteryWrap: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  batteryBody: {
    borderColor: colors.textMuted,
    borderRadius: 2,
    borderWidth: 1,
    height: 8,
    width: 12,
  },
  batteryNub: {
    backgroundColor: colors.textMuted,
    borderRadius: 0.5,
    height: 3.5,
    marginLeft: 1,
    width: 1.5,
  },
});
