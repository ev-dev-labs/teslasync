// TemperatureMetricCards — native parity port of
// web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx.
//
// The web component is the drivetrain-health metric strip: a responsive grid
// (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3`) of `MetricCard`s — one per
// temperature sensor (label, formatted temperature, severity-tinted icon chip,
// "% of max" / "No data" subtitle) followed by two fixed cards: a Health Score
// card (`{healthScore}%`, Heart icon, health-tinted) and a Peak Power card
// (`{peakPower} kW` or "—", Zap icon, purple). Each card is wrapped in a
// `StaggerItem` inside a `StaggerContainer` so the cards fade/slide in with a
// per-child delay.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next useTranslation (web L1) -> native-safe t(key, fallback)
//     keeping every drivetrain.* key + sensor label key/default verbatim.
//   - lucide-react Heart / Zap (web L2): lucide is browser-only SVG and
//     forbidden in native output (rule 4). The two icons CREATED here are
//     rendered as the native SemanticIcon glyph vocabulary — Heart -> 'heart'
//     ('HR'), Zap -> 'bolt' ('ZP') — tinted to the card's neon colour inside the
//     icon chip, exactly like the web `<div className={c.text}><Heart/></div>`
//     (the UsageCard renderNode + getSemanticIconDefinition glyph precedent).
//   - `@/components/data-display` MetricCard (web L4): no native MetricCard
//     parity port exists yet, so a local MetricCard is built from RN primitives
//     reproducing the web structure (text column: metric-label eyebrow + bold
//     value + muted subtitle; right-aligned colour-tinted icon chip). Only the
//     props this file uses (label/value/icon/color/subtitle) are ported — the
//     change/delta/help slots are the MetricCard's own conversion turn.
//   - `@/components/motion` StaggerContainer + StaggerItem (web L5): the native
//     StaggerContainer lays its children out in a plain column View (each child
//     wrapped in a width-less Animated.View), which cannot host the web's
//     responsive 2/3/6-column grid. So the StaggerContainer+StaggerItem entrance
//     orchestration is reproduced locally as a StaggerGrid: a row-wrap grid whose
//     animated cells carry the 2-column sizing AND the per-child fade/slide +
//     `index * 0.06s` delay, reduced-motion-aware (the native StaggerContainer
//     timing/reduced-motion precedent).
//   - `@/hooks/useUnits` useUnits().formatTemperature (web L6/26-27): this parity
//     tree has no settings wiring, so the web SI-floor default ('°C',
//     precision 1) is used directly — the formatTemperature(value, precision)
//     two-layer wrapper is preserved field-for-field (the TemperatureSection
//     precedent).
//   - `@/lib/numberFormat` fmtNumber / fmtInt (web L7) -> ported inline with the
//     web global defaults (precision 2 / locale en-US; fmtInt == precision 0).
//   - `./constants` HealthStatus / TempSensor (web L9) -> reproduced inline (the
//     sibling native constants.ts is its own conversion turn, the HealthOverview
//     inline-types precedent).
//   - `./helpers` tempNeonColor / displayTemp (web L10) -> reproduced inline
//     field-for-field.
// No DOM / lucide-react / Recharts / Leaflet / old web-UI imports — RN
// primitives only. See the .parity.json sidecar for the line-by-line map.

import React, {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';

// ---- Inlined `./constants` types (own conversion turn) ----------------------

type HealthStatus = 'good' | 'warning' | 'critical';

// web `@/lib/tokens` NeonColor — the MetricCard `color` union.
type NeonColor = 'cyan' | 'green' | 'red' | 'purple' | 'amber' | 'blue';

interface TempSensor {
  key: string;
  labelKey: string;
  defaultLabel: string;
  value: number | null;
  maxTemp: number;
  color: string;
  icon: ReactNode;
}

// ---- Inlined `./helpers` (own conversion turn) ------------------------------

// web ./helpers tempNeonColor: null -> green; ratio >= 0.85 -> red; >= 0.65 ->
// amber; else green. Drives the icon-chip severity colour.
function tempNeonColor(
  celsius: number | null,
  max: number,
): 'green' | 'amber' | 'red' {
  if (celsius === null) {
    return 'green';
  }
  const ratio = celsius / max;
  if (ratio >= 0.85) {
    return 'red';
  }
  if (ratio >= 0.65) {
    return 'amber';
  }
  return 'green';
}

// web ./helpers displayTemp: null -> '—', else the formatted temperature.
function displayTemp(
  celsius: number | null,
  formatTemperature: (c: number) => string,
): string {
  if (celsius === null) {
    return '—';
  }
  return formatTemperature(celsius);
}

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// ---- Native-safe number formatting (web @/lib/numberFormat) ------------------
// fmtNumber/fmtInt ported with the web global defaults: precision 2, locale
// en-US (fmtInt == precision 0). The parity tree has no useSettings overrides.

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeNumber(value: unknown): number {
  return isFiniteNumber(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = DEFAULT_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

// ---- Native-safe temperature formatter (web useUnits().formatTemperature) ----
// The web hook converts an SI Celsius value to the user's unit and appends the
// suffix with NO space before the ° unit. With no settings wiring here, the
// SI-floor default ('°C', convertTempFromSI identity, precision 1) is used.

const DEFAULT_TEMP_UNIT = '°C';
const DEFAULT_TEMP_PRECISION = 1;

function resolveTempPrecision(override?: number): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  return DEFAULT_TEMP_PRECISION;
}

function formatTemperatureUnit(
  value: number | null | undefined,
  options?: {precision?: number},
): string {
  if (!isFiniteNumber(value)) {
    return '—';
  }
  return `${fmtNumber(value, resolveTempPrecision(options?.precision))}${DEFAULT_TEMP_UNIT}`;
}

// ---- Neon colour map (web @/lib/tokens neonColorMap) ------------------------
// `text` = Tailwind 300-level shade; `bg`/`ring` = the neon hue at 10% / 20%
// alpha (tailwind.config.js neon palette). Mirrors the web MetricCard icon chip
// `bg-neon-{c}/10 ring-neon-{c}/20` with the icon glyph tinted `text-{c}-300`.

const NEON_COLOR: Record<
  NeonColor,
  {text: string; bg: string; ring: string}
> = {
  cyan: {text: '#67e8f9', bg: 'rgba(0, 240, 255, 0.1)', ring: 'rgba(0, 240, 255, 0.2)'},
  green: {text: '#6ee7b7', bg: 'rgba(16, 185, 129, 0.1)', ring: 'rgba(16, 185, 129, 0.2)'},
  red: {text: '#fda4af', bg: 'rgba(239, 68, 68, 0.1)', ring: 'rgba(239, 68, 68, 0.2)'},
  purple: {text: '#d8b4fe', bg: 'rgba(168, 85, 247, 0.1)', ring: 'rgba(168, 85, 247, 0.2)'},
  amber: {text: '#fcd34d', bg: 'rgba(245, 158, 11, 0.1)', ring: 'rgba(245, 158, 11, 0.2)'},
  blue: {text: '#a5b4fc', bg: 'rgba(79, 70, 229, 0.1)', ring: 'rgba(79, 70, 229, 0.2)'},
};

// web L2 lucide Heart / Zap -> native SemanticIcon glyph vocabulary.
const HEART_GLYPH = getSemanticIconDefinition('heart').glyph;
const ZAP_GLYPH = getSemanticIconDefinition('bolt').glyph;

// ---- Reduced-motion awareness (web prefers-reduced-motion) ------------------

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// ---- StaggerGrid (web StaggerContainer + StaggerItem, grid layout) -----------
// Reproduces the web staggered entrance (per-child fade + slide with a
// `index * 0.06s` delay, collapsing to the final state under reduced motion) AND
// the responsive grid by carrying the 2-column cell sizing on the animated
// wrapper itself — the native StaggerContainer's column layout cannot host the
// grid, so the orchestration is reproduced locally (its timing constants reused).

const STAGGER_SECONDS = 0.06;
const ENTRANCE_DURATION_MS = 300;
const ENTRANCE_TRANSLATE_Y = 8;
const GRID_GUTTER = 12; // web gap-3

function StaggerGridItem({
  children,
  delayMs,
  reduceMotion,
}: {
  children: ReactNode;
  delayMs: number;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delayMs,
      duration: ENTRANCE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [delayMs, progress, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.cell,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [ENTRANCE_TRANSLATE_Y, 0],
              }),
            },
          ],
        },
      ]}>
      {children}
    </Animated.View>
  );
}

StaggerGridItem.displayName = 'StaggerGridItem';

function StaggerGrid({children}: {children: ReactNode}): React.ReactElement {
  const reduceMotion = useReduceMotion();
  const staggerMs = (reduceMotion ? 0 : STAGGER_SECONDS) * 1000;
  const items = React.Children.toArray(children);

  return (
    <View style={styles.grid}>
      {items.map((child, index) => (
        <StaggerGridItem
          key={index}
          delayMs={index * staggerMs}
          reduceMotion={reduceMotion}>
          {child}
        </StaggerGridItem>
      ))}
    </View>
  );
}

StaggerGrid.displayName = 'StaggerGrid';

// ---- Local MetricCard (web @/components/data-display MetricCard) -------------
// Reproduces the web card: a text column (metric-label eyebrow + bold value +
// muted subtitle) beside a right-aligned colour-tinted icon chip. Only the slots
// this file uses are ported (label/value/icon/color/subtitle).

// web MetricCard renders `<div className={c.text}>{icon}</div>` — a bare glyph
// inherits the tint; a self-styled node keeps its own styling. Mirror that: bare
// string/number glyphs are wrapped in a tinted AppText, elements render as-is.
function renderCardIcon(icon: ReactNode, color: string): ReactNode {
  if (icon === null || icon === undefined || icon === false || icon === true) {
    return null;
  }
  if (typeof icon === 'string' || typeof icon === 'number') {
    return <AppText style={[styles.iconGlyph, {color}]}>{icon}</AppText>;
  }
  return icon;
}

function MetricCard({
  label,
  value,
  icon,
  color = 'cyan',
  subtitle,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  color?: NeonColor;
  subtitle?: string;
}): React.ReactElement {
  const c = NEON_COLOR[color];

  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardText}>
          <AppText numberOfLines={1} style={styles.metricLabel} tone="muted">
            {label}
          </AppText>
          <AppText style={styles.metricValue}>{value}</AppText>
          {subtitle ? (
            <AppText numberOfLines={1} style={styles.metricSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {icon ? (
          <View style={[styles.iconChip, {backgroundColor: c.bg, borderColor: c.ring}]}>
            {renderCardIcon(icon, c.text)}
          </View>
        ) : null}
      </View>
    </View>
  );
}

MetricCard.displayName = 'MetricCard';

// ---- Component --------------------------------------------------------------

interface TemperatureMetricCardsProps {
  sensors: TempSensor[];
  overallHealth: HealthStatus;
  healthScore: number;
  peakPower: number;
}

export function TemperatureMetricCards({
  sensors,
  overallHealth,
  healthScore,
  peakPower,
}: TemperatureMetricCardsProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const formatTemperature = (
    value: number | null | undefined,
    precision?: number,
  ) => formatTemperatureUnit(value, {precision});

  return (
    <StaggerGrid>
      {sensors.map(sensor => (
        <MetricCard
          key={sensor.key}
          color={tempNeonColor(sensor.value, sensor.maxTemp)}
          icon={sensor.icon}
          label={t(sensor.labelKey, sensor.defaultLabel)}
          subtitle={
            sensor.value !== null
              ? `${fmtNumber((sensor.value / sensor.maxTemp) * 100, 0)}% ${t(
                  'drivetrain.ofMax',
                  'of max',
                )}`
              : t('drivetrain.noData', 'No data')
          }
          value={displayTemp(sensor.value, formatTemperature)}
        />
      ))}
      <MetricCard
        color={
          overallHealth === 'good'
            ? 'green'
            : overallHealth === 'warning'
              ? 'amber'
              : 'red'
        }
        icon={HEART_GLYPH}
        label={t('drivetrain.healthScore', 'Health Score')}
        value={`${healthScore}%`}
      />
      <MetricCard
        color="purple"
        icon={ZAP_GLYPH}
        label={t('drivetrain.peakPower', 'Peak Power')}
        value={peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'}
      />
    </StaggerGrid>
  );
}

TemperatureMetricCards.displayName = 'TemperatureMetricCards';

const styles = StyleSheet.create({
  // web StaggerContainer `grid grid-cols-2 gap-3 …` -> a 2-column row-wrap grid;
  // the negative gutter + per-cell padding reproduce gap-3 (12) without the
  // percentage-vs-gap overflow risk.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -GRID_GUTTER / 2,
  },
  cell: {
    width: '50%',
    paddingHorizontal: GRID_GUTTER / 2,
    marginBottom: GRID_GUTTER,
  },
  // web MetricCard root `p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]`.
  card: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  // web inner `flex items-start justify-between gap-2`.
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  // web text column `flex-1 min-w-0`.
  cardText: {
    flex: 1,
    minWidth: 0,
  },
  // web `metric-label mb-1 text-[10px] truncate` (text-2xs medium uppercase
  // tracking-wider muted).
  metricLabel: {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  // web value `text-xl font-bold tracking-tight text-[var(--text-primary)]`.
  metricValue: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  // web subtitle `mt-0.5 text-[10px] text-[var(--text-muted)] truncate`.
  metricSubtitle: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 13,
  },
  // web icon chip `flex items-center justify-center rounded-lg p-1.5 ring-1 shrink-0`.
  iconChip: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 6,
    flexShrink: 0,
  },
  // web icon `h-4 w-4` tinted `c.text`; rendered as the SemanticIcon glyph.
  iconGlyph: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
