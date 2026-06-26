// TirePressureVisualWidget — native parity port of
// web/src/features/dashboard/widgets/TirePressureVisualWidget.tsx.
//
// The dashboard "Tire Pressure" widget. It resolves a vehicle from the explicit
// `vehicleId` prop, falling back to the first vehicle (`useVehicles`), then reads
// that vehicle's latest tire-pressure snapshot (`GET /tire-pressure/latest?
// vehicle_id=` via useLatestTirePressure, 10_000ms poll). It maps the four
// corner readings (front_left / front_right / rear_left / rear_right) into a
// fixed [FL, FR, RL, RR] TireInfo tuple, each tagged with a green/amber/red
// pressure status from the bar THRESHOLD table, then renders one of two branches,
// preserved verbatim from the web source:
//   1. tireData -> a top-down car diagram (four status-coloured tires) flanked by
//      a left FL/RL value column and a right FR/RR value column, over a footer row
//      with a status Badge (All Normal / Check Pressure) and a "unit · reading
//      time" caption.
//   2. no tireData -> an EmptyState (CircleDot glyph + "No tire pressure data").
// Every state name (vehicles, id, tireData, isLoading, error, isFetching,
// isStale, isError, dataUpdatedAt, refetch, pressureUnit, toPressureValue,
// isCompact, tires, allNormal, hasWarning, latestReading), the
// /tire-pressure/latest API path, the bar THRESHOLD constants + getPressureStatus
// classifier, the SI(kPa)->bar conversion, the i18n key + English fallback for
// every label, and each render branch is preserved; all 202 source lines are
// mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react-i18next useTranslation('dashboard') (web L1) -> the native
//     t(key, fallback) shim used across the parity tree (the namespace is
//     accepted-and-ignored — there is no i18n runtime in RN); the same `t` is
//     handed to the module-level formatTimestamp, whose
//     (k, fb) => string contract is preserved.
//   - lucide-react CircleDot (web L2) -> the native SemanticIcon 'tirePressure'
//     glyph via getSemanticIconDefinition (lucide is browser-only); the title
//     glyph is tinted with the accent token (web text-neon-cyan) and the
//     empty-state glyph with the muted token (web's class-less CircleDot).
//   - @/components/ui Badge (web L3) -> an inline native Badge pill that maps the
//     web variant prop values (success / warning / danger) to the matching
//     surface+border+text theme tokens — the ui barrel Badge is a DOM <span> and
//     is not in the native parity manifest.
//   - @/components/feedback EmptyState (web L4) -> an inline native EmptyState
//     (icon chip + muted centered message); the feedback barrel is a DOM tree and
//     is not in the native parity manifest.
//   - @/api/hooks useVehicles/useLatestTirePressure (web L5) -> imported from
//     their canonical converted native hook (../../../api/hooks/useVehicles) —
//     same query keys, same /vehicles + /tire-pressure/latest paths, same
//     TirePressureSnapshot fields, same 10_000ms refetch interval.
//   - @/hooks/usePressureFormat (web L6) -> reproduced inline. The web hook reads
//     useUnits()/useSettings(), which the parity tree lacks; per the
//     ActiveVehicleSegment no-settings precedent it resolves to the web default
//     (derivePressure(undefined) === 'bar'), so pressureUnit === 'bar' and
//     toPressureValue(v) === convertPressureFromSI(v, 'bar') with the same
//     null/!finite -> null guard. convertPressureFromSI (a non-deprecated
//     unitConversion export) is ported verbatim alongside its KPA_PER_BAR /
//     KPA_PER_PSI constants and the PressureUnitPref type.
//   - @/lib/numberFormat fmtNumber (web L7) -> ported inline native-safe. The web
//     fmtNumber -> Number.toLocaleString depends on a global precision/locale set
//     by useSettings plus a full Intl runtime; the inline port reproduces the
//     fixed-precision en-US grouped output (fmtNumber(1234.56, 1) -> "1,234.6")
//     and returns the precision-formatted "0" for nullish/NaN, matching
//     safeNumber.
//   - ./WidgetShell (web L8) + ./types WidgetProps (web L9) -> reproduced
//     self-contained here, per the SafetyFeaturesWidget inline-reproduction
//     precedent. WidgetShell's browser-only DataFreshness/PinButton/HelpTooltip/
//     Skeleton/QueryError chrome becomes a native-safe freshness pill (relative
//     "updated" time + a refresh Pressable wired to onRefresh, with stale/error/
//     fetching markers), a dimmed skeleton box, and a centered error message; the
//     title-aware header matches the web shell's title vs. title-less branches.
//   - The web CarDiagram is an inline SVG (<svg>/<rect>/<line>) and
//     react-native-svg is NOT a dependency (see EnergyFlowAnimatedWidget), so the
//     diagram is rebuilt with React Native primitives: a fixed-aspect 120x180
//     viewBox is scaled to a 140px-tall box (the web max-h-[140px] cap) and every
//     element (car-body rounded rect, windshield/rear hint lines, the four
//     status-coloured rounded-rect tires at their exact viewBox coordinates with
//     the 0.85 fill opacity) is an absolute-positioned View at the scaled
//     coordinate.
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports reach
// the native output — only react, react-native primitives, the canonical AppText
// + GlassPanel + SemanticIcon, the parity hook, and theme tokens.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {
  useLatestTirePressure,
  useVehicles,
} from '../../../api/hooks/useVehicles';

// ── Ported widget types (web ./types WidgetProps / WidgetSize) ────────────────

/** Grid footprint in cols/rows (web `./types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Widget render props (web `./types` WidgetProps). `config` is accepted for
 *  source parity but, like the web source, this widget reads only vehicleId +
 *  size. */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── Ported number format (web @/lib/numberFormat fmtNumber / safeNumber) ──────

/** Safe number extraction from unknown values, returns 0 for nullish/NaN. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Native-safe fixed-precision format with en-US thousands grouping:
 *  fmtNumber(1234.56, 1) -> "1,234.6", fmtNumber(null, 1) -> "0.0". */
function fmtNumber(v: unknown, decimals = 2): string {
  const fixed = safeNumber(v).toFixed(decimals);
  const negative = fixed.startsWith('-');
  const unsigned = negative ? fixed.slice(1) : fixed;
  const dot = unsigned.indexOf('.');
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracPart = dot === -1 ? '' : unsigned.slice(dot);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fracPart}`;
}

// ── Ported pressure conversion (web @/lib/unitConversion, non-deprecated) ─────

/** Pressure display unit (web `PressureUnitPref`). */
type PressureUnitPref = 'kPa' | 'psi' | 'bar';

/** 1 psi = 6.894757 kPa (NIST SP 811, rounded to display precision). */
const KPA_PER_PSI = 6.894757;
/** 1 bar = 100 kPa (BIPM definition). */
const KPA_PER_BAR = 100;

/** Convert pressure from SI kilopascals to the user's display unit. Ported
 *  verbatim from web `convertPressureFromSI`. */
function convertPressureFromSI(kpa: number, to: PressureUnitPref): number {
  switch (to) {
    case 'kPa':
      return kpa;
    case 'psi':
      return kpa / KPA_PER_PSI;
    case 'bar':
      return kpa / KPA_PER_BAR;
  }
}

/** Native reproduction of web `usePressureFormat`. The parity tree has no
 *  settings provider, so it resolves to the web no-settings default
 *  (derivePressure(undefined) === 'bar'): pressureUnit 'bar' and toPressureValue
 *  via convertPressureFromSI(_, 'bar') with the same null/!finite -> null guard.
 *  formatPressureValue is part of the web hook's contract but unused by this
 *  widget, so it is intentionally omitted. */
function usePressureFormat(): {
  pressureUnit: PressureUnitPref;
  toPressureValue: (pa: number | null | undefined) => number | null;
} {
  const pressureUnit: PressureUnitPref = 'bar';
  const toPressureValue = React.useCallback(
    (pa: number | null | undefined): number | null => {
      if (pa == null || !Number.isFinite(pa)) return null;
      return convertPressureFromSI(pa, pressureUnit);
    },
    [pressureUnit],
  );
  return {pressureUnit, toPressureValue};
}

// ── Domain logic (web L11-36) — pure, native-safe ─────────────────────────────

/** Pressure thresholds in bar for color coding. */
const THRESHOLD = {
  dangerLow: 2.068,
  warnLow: 2.275,
  warnHigh: 2.896,
  dangerHigh: 3.103,
} as const;

function getPressureStatus(bar: number | null): 'green' | 'amber' | 'red' {
  if (bar == null) return 'red';
  if (bar < THRESHOLD.dangerLow || bar > THRESHOLD.dangerHigh) return 'red';
  if (bar < THRESHOLD.warnLow || bar > THRESHOLD.warnHigh) return 'amber';
  return 'green';
}

/** Per-status fill (SVG fill hex) + text colour (web tailwind -300 -> hex). */
const STATUS_COLORS = {
  green: {fill: '#22c55e', text: '#6ee7b7'}, // web text-emerald-300
  amber: {fill: '#f59e0b', text: '#fcd34d'}, // web text-amber-300
  red: {fill: '#ef4444', text: '#fda4af'}, // web text-rose-300
} as const;

interface TireInfo {
  label: string;
  value: number | null;
  status: 'green' | 'amber' | 'red';
}

// ── Native CarDiagram (web inline <svg> car silhouette, viewBox 0 0 120 180) ──

const VIEW_W = 120;
const VIEW_H = 180;
const DIAGRAM_HEIGHT = 140; // web max-h-[140px]
const DIAGRAM_SCALE = DIAGRAM_HEIGHT / VIEW_H;
const DIAGRAM_WIDTH = VIEW_W * DIAGRAM_SCALE;
/** Scale a viewBox coordinate into the rendered diagram space. */
const sx = (n: number): number => n * DIAGRAM_SCALE;

/**
 * Top-down car silhouette with four tire indicators. Each tire is a rounded
 * rect coloured by pressure status. Rebuilt with absolute-positioned Views at
 * the exact web viewBox coordinates (react-native-svg is not a dependency).
 */
function CarDiagram({tires}: {tires: [TireInfo, TireInfo, TireInfo, TireInfo]}) {
  const [fl, fr, rl, rr] = tires;

  // Tire positions (x, y) for top-down — viewBox 0 0 120 180 (web L46-51).
  const tirePositions = [
    {tire: fl, x: 14, y: 28}, // front-left
    {tire: fr, x: 90, y: 28}, // front-right
    {tire: rl, x: 14, y: 126}, // rear-left
    {tire: rr, x: 90, y: 126}, // rear-right
  ];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.diagram}>
      {/* Car body outline (web rect x30 y16 w60 h148 rx16) */}
      <View
        style={[
          styles.carBody,
          {
            left: sx(30),
            top: sx(16),
            width: sx(60),
            height: sx(148),
            borderRadius: sx(16),
            borderWidth: sx(1.5),
          },
        ]}
      />
      {/* Windshield hint (web line y52) */}
      <View
        style={[
          styles.hintLine,
          {left: sx(36), top: sx(52), width: sx(48), height: sx(1)},
        ]}
      />
      {/* Rear window hint (web line y132) */}
      <View
        style={[
          styles.hintLine,
          {left: sx(36), top: sx(132), width: sx(48), height: sx(1)},
        ]}
      />
      {/* Tires (web rect w16 h26 rx4, fillOpacity 0.85) */}
      {tirePositions.map(({tire, x, y}) => (
        <View
          key={tire.label}
          style={[
            styles.tire,
            {
              left: sx(x),
              top: sx(y),
              width: sx(16),
              height: sx(26),
              borderRadius: sx(4),
              backgroundColor: STATUS_COLORS[tire.status].fill,
            },
          ]}
        />
      ))}
    </View>
  );
}

// ── Reading-time formatting (web L78-93) — pure, native-safe ──────────────────

function formatTimestamp(
  iso: string | undefined,
  t: (k: string, fb: string) => string,
): string {
  if (!iso) return t('widget.tireNoReading', 'No reading');
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    const now = Date.now();
    const diffMin = Math.round((now - date.getTime()) / 60_000);
    if (diffMin < 1) return t('widget.tireJustNow', 'Just now');
    if (diffMin < 60) return `${diffMin}m ${t('widget.ago', 'ago')}`;
    const diffHrs = Math.round(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ${t('widget.ago', 'ago')}`;
    return `${Math.round(diffHrs / 24)}d ${t('widget.ago', 'ago')}`;
  } catch {
    return '—';
  }
}

// ── SemanticIcon glyph node (web lucide icon nodes) ──────────────────────────

/** Renders a decorative glyph in the given color, replacing a web lucide
 *  `<Icon className="…" />` node. */
function glyphNode(
  name: SemanticIconName,
  color: string,
  glyphStyle: StyleProp<TextStyle>,
): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[glyphStyle, {color}]}
      weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

// ── Inline native Badge (web @/components/ui Badge) ───────────────────────────

type BadgeVariant = 'success' | 'warning' | 'danger';

function Badge({variant, children}: {variant: BadgeVariant; children: string}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ───────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative "updated" time: <1m "Just now", <60m "Xm ago", <24h "Xh ago",
 *  else the absolute date-time. */
function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return formatDateTime(isoStr);
}

/** Native-safe freshness pill: relative "updated" time + refresh affordance,
 *  reflecting the query's fetching/stale/error flags. Replaces the web
 *  DataFreshness chrome (which depends on browser-only timers/icons). */
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  if (isError) label = 'Error';
  else if (isFetching) label = 'Updating…';
  else if (updatedAt > 0)
    label = formatRelativeTime(new Date(updatedAt).toISOString());
  else label = 'Never';

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onRefresh}
      style={styles.freshness}>
      <AppText
        style={[
          styles.freshnessText,
          isError
            ? styles.freshnessError
            : isStale
              ? styles.freshnessStale
              : null,
        ]}>
        {label}
      </AppText>
      <AppText style={styles.refreshGlyph} weight="bold">
        {getSemanticIconDefinition('refresh').glyph}
      </AppText>
    </Pressable>
  );
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  if (loading) {
    return <View accessibilityLabel="Loading" style={styles.skeleton} />;
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.errorBox}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.shell}>
      <View style={[styles.shellHeader, !title && styles.shellHeaderEnd]}>
        {title ? (
          <View style={styles.shellTitleGroup}>
            {icon}
            <AppText style={styles.shellTitle}>{title}</AppText>
          </View>
        ) : null}
        <DataFreshness
          isError={isError ?? false}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          onRefresh={onRefresh}
          updatedAt={updatedAt ?? 0}
        />
      </View>
      <View style={styles.shellBody}>{children}</View>
    </GlassPanel>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export default function TirePressureVisualWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: tireData,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useLatestTirePressure(id, 10_000);
  const {pressureUnit, toPressureValue} = usePressureFormat();

  const isCompact = size.cols <= 1;

  const tires: [TireInfo, TireInfo, TireInfo, TireInfo] = [
    {
      label: 'FL',
      value: tireData?.front_left ?? null,
      status: getPressureStatus(tireData?.front_left ?? null),
    },
    {
      label: 'FR',
      value: tireData?.front_right ?? null,
      status: getPressureStatus(tireData?.front_right ?? null),
    },
    {
      label: 'RL',
      value: tireData?.rear_left ?? null,
      status: getPressureStatus(tireData?.rear_left ?? null),
    },
    {
      label: 'RR',
      value: tireData?.rear_right ?? null,
      status: getPressureStatus(tireData?.rear_right ?? null),
    },
  ];

  const allNormal = tires.every(tire => tire.status === 'green');
  const hasWarning = tires.some(tire => tire.status !== 'green');

  const formatPressure = (val: number | null): string => {
    const v = toPressureValue(val);
    return v != null ? `${fmtNumber(v, 1)}` : '—';
  };

  // Most recent reading time across all tires.
  const latestReading: string | undefined = tireData
    ? [
        tireData.last_seen_time_fl,
        tireData.last_seen_time_fr,
        tireData.last_seen_time_rl,
        tireData.last_seen_time_rr,
      ]
        .filter(Boolean)
        .sort()
        .pop()
    : undefined;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.tirePressure', 'Tire Pressure')}
      icon={glyphNode('tirePressure', colors.accent, styles.titleGlyph)}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {tireData ? (
        <View style={styles.container}>
          {/* Car diagram + pressure values */}
          <View style={styles.diagramRow}>
            {/* Left column: FL / RL values */}
            <View style={[styles.valueColumn, styles.valueColumnLeft]}>
              <View style={styles.valueColumnRight}>
                <AppText style={styles.valueLabel}>
                  {t('widget.tireFL', 'FL')}
                </AppText>
                <AppText
                  style={[
                    styles.valueText,
                    {color: STATUS_COLORS[tires[0].status].text},
                  ]}
                  weight="bold">
                  {formatPressure(tires[0].value)}
                </AppText>
              </View>
              <View style={styles.valueColumnRight}>
                <AppText style={styles.valueLabel}>
                  {t('widget.tireRL', 'RL')}
                </AppText>
                <AppText
                  style={[
                    styles.valueText,
                    {color: STATUS_COLORS[tires[2].status].text},
                  ]}
                  weight="bold">
                  {formatPressure(tires[2].value)}
                </AppText>
              </View>
            </View>

            {/* Center: car diagram */}
            <View style={styles.diagramCenter}>
              <CarDiagram tires={tires} />
            </View>

            {/* Right column: FR / RR values */}
            <View style={[styles.valueColumn, styles.valueColumnRightCol]}>
              <View style={styles.valueColumnLeftAlign}>
                <AppText style={styles.valueLabel}>
                  {t('widget.tireFR', 'FR')}
                </AppText>
                <AppText
                  style={[
                    styles.valueText,
                    {color: STATUS_COLORS[tires[1].status].text},
                  ]}
                  weight="bold">
                  {formatPressure(tires[1].value)}
                </AppText>
              </View>
              <View style={styles.valueColumnLeftAlign}>
                <AppText style={styles.valueLabel}>
                  {t('widget.tireRR', 'RR')}
                </AppText>
                <AppText
                  style={[
                    styles.valueText,
                    {color: STATUS_COLORS[tires[3].status].text},
                  ]}
                  weight="bold">
                  {formatPressure(tires[3].value)}
                </AppText>
              </View>
            </View>
          </View>

          {/* Footer: status badge + unit + reading time */}
          <View style={styles.footer}>
            <Badge variant={allNormal ? 'success' : hasWarning ? 'warning' : 'danger'}>
              {allNormal
                ? t('widget.tireAllNormal', 'All Normal')
                : t('widget.tireWarning', 'Check Pressure')}
            </Badge>
            <AppText style={styles.footerCaption}>
              {`${pressureUnit} · ${formatTimestamp(latestReading, t)}`}
            </AppText>
          </View>
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={glyphNode('tirePressure', colors.textMuted, styles.emptyGlyph)}
          message={t('widget.noTireData', 'No tire pressure data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  carBody: {
    borderColor: colors.border,
    position: 'absolute',
  },
  container: {
    flex: 1,
    gap: 8,
  },
  diagram: {
    alignSelf: 'center',
    height: DIAGRAM_HEIGHT,
    position: 'relative',
    width: DIAGRAM_WIDTH,
  },
  diagramCenter: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  diagramRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 0,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyGlyph: {
    fontSize: 13,
    letterSpacing: 0.2,
    lineHeight: 16,
    textAlign: 'center',
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    justifyContent: 'space-between',
  },
  footerCaption: {
    color: colors.textMuted,
    fontSize: 10,
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessError: {
    color: colors.danger,
  },
  freshnessStale: {
    color: colors.warning,
  },
  freshnessText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  hintLine: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    position: 'absolute',
  },
  refreshGlyph: {
    color: colors.accent,
    fontSize: 10,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  shellHeaderEnd: {
    justifyContent: 'flex-end',
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  shellTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    flex: 1,
    minHeight: 120,
  },
  tire: {
    opacity: 0.85,
    position: 'absolute',
  },
  titleGlyph: {
    fontSize: 11,
    lineHeight: 14,
  },
  valueColumn: {
    height: '100%',
    justifyContent: 'space-between',
    minWidth: 50,
    paddingVertical: 8,
  },
  valueColumnLeft: {
    alignItems: 'flex-end',
  },
  valueColumnLeftAlign: {
    alignItems: 'flex-start',
  },
  valueColumnRight: {
    alignItems: 'flex-end',
  },
  valueColumnRightCol: {
    alignItems: 'flex-start',
  },
  valueLabel: {
    color: colors.textMuted,
    fontSize: 10,
    textTransform: 'uppercase',
  },
  valueText: {
    fontSize: 14,
  },
});

const badgeVariantStyles = StyleSheet.create({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextStyles = StyleSheet.create({
  danger: {
    color: colors.danger,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});
