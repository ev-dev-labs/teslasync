// Native parity port of web/src/features/dashboard/widgets/LiveSignalsWidget.tsx.
//
// The web module is the dashboard "Live Signals" widget. For the selected (or
// first) vehicle it polls four "latest" snapshot endpoints every 5s — motor
// (GET /api/v1/motor/latest), climate (GET /api/v1/climate/latest), security
// (GET /api/v1/security/latest) and tire pressure
// (GET /api/v1/tire-pressure/latest) — and renders a 2-column grid of four
// labelled sections:
//   • Motor: Torque (`{di_torque} Nm`), Temp (di_stator_temp SI°C -> display),
//     Gear (cleanNil(gear));
//   • Climate: Cabin (inside_temp), Outside (outside_temp), HVAC
//     (`{hvac_power} kW`);
//   • Tires: FL / FR / RL / RR (front_left/front_right/rear_left/rear_right,
//     SI kPa -> display);
//   • Security: Lock (locked -> success/danger Badge) and Sentry
//     (sentry_mode -> success/neutral Badge).
// Each section falls back to a Skeleton while its own snapshot is still null.
// When every snapshot is missing the widget shows an EmptyState. Freshness +
// refresh are driven solely by the motor query (updatedAt/fetching/stale/error/
// refetch), exactly as in the source.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • lucide-react Wifi/Cog/Thermometer/CircleDot -> the app SemanticIcon
//     'wifi'/'settings'/'climate'/'tirePressure' glyphs rendered as colour-tinted
//     AppText (GlyphIcon): the header Wifi is accent (text-neon-cyan), Cog is
//     violet (text-purple-300), Thermometer/CircleDot are accent (text-cyan-300),
//     and the EmptyState Wifi is muted (the web `h-5 w-5` icon carries no colour).
//     The Security header's literal 🛡️ emoji is preserved verbatim.
//   • @/components/ui Badge -> a local native pill Badge (success/warning/danger/
//     neutral surface+text tints) covering the two security call sites.
//   • @/components/feedback Skeleton + EmptyState -> the native parity Skeleton
//     (h-12 -> height 48) and EmptyState (className py-4 -> a paddingVertical
//     style).
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly the
//     props this call site uses (title/icon/updatedAt/isFetching/isStale/isError/
//     onRefresh/children): a header row (icon + uppercase title + freshness/
//     refresh affordance). The source never passes loading/error, so no Skeleton
//     shell or inline error block renders — error surfaces through the freshness
//     "Error" state, as in web.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • @/hooks/useUnits useUnits -> a local useUnits() that reads the native
//     useSettings() query and derives the same `unitPrefs` (temperature/pressure/
//     locale) via the web deriveTemperature/derivePressure/deriveLocale rules.
//   • @/lib/unitConversion convertTempFromSI/convertPressureFromSI -> inlined
//     verbatim (Celsius -> °C/°F; kPa -> kPa/psi/bar with the NIST factors).
//   • @/lib/numberFormat fmtNumber/fmtInt -> inlined locale-aware fixed-decimal
//     helpers; the source's global-locale singleton is replaced by the
//     settings-derived locale (RN has no global-locale singleton).
//   • @/lib/cleanNil cleanNil -> inlined verbatim (Go "<nil>"/"nil"/"null" -> undefined).
//   • @/api/hooks/useVehicles useVehicles/useMotorLatest/useClimateLatest/
//     useSecurityLatest/useLatestTirePressure -> the already-ported native parity
//     hooks (same names / return shapes / API paths / 5s refetch interval).
//   • DOM <div>/<span>/<h4> + Tailwind classes + overflow-y-auto -> React Native
//     View/ScrollView/AppText with StyleSheet tokens; text-[var(--text-*)] -> the
//     AppText tones. The DataFreshness header indicator is computed once at render
//     (no interval) to avoid a dangling timer under --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {
  useClimateLatest,
  useLatestTirePressure,
  useMotorLatest,
  useSecurityLatest,
  useVehicles,
} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';

const DEFAULT_LOCALE = 'en-US';

/* ─── ./types (dashboard widget registry types, ported verbatim) ─────────── */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat (fmtNumber / fmtInt) ────────────────────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max), falling back to en-US on a bad locale tag.
// The web global locale singleton (set by useSettings) is replaced here by the
// settings-derived locale threaded from useUnits().
function fmtNumber(
  value: unknown,
  decimals: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

// web @/lib/numberFormat fmtInt(v) === fmtNumber(v, 0).
function fmtInt(value: unknown, locale: string = DEFAULT_LOCALE): string {
  return fmtNumber(value, 0, locale);
}

/* ─── inlined @/lib/cleanNil ─────────────────────────────────────────────── */

// Filters Go nil string representations (Sprintf("%v", nil) -> "<nil>") that the
// API can echo back as literal strings.
function cleanNil(v?: string | null): string | undefined {
  if (!v || v === '<nil>' || v === 'nil' || v === 'null') return undefined;
  return v;
}

/* ─── inlined @/lib/unitConversion (SI → display, ported verbatim) ───────── */

type TemperatureUnitPref = '°C' | '°F';
type PressureUnitPref = 'kPa' | 'psi' | 'bar';

/** 1 psi = 6.894757 kPa (NIST SP 811). */
const KPA_PER_PSI = 6.894757;
/** 1 bar = 100 kPa (BIPM definition). */
const KPA_PER_BAR = 100;

// Convert temperature from SI Celsius to the user's display unit.
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// Convert pressure from SI kilopascals to the user's display unit.
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

/* ─── settings-derived @/hooks/useUnits (temperature/pressure subset) ─────── */

interface UnitPrefs {
  temperature: TemperatureUnitPref;
  pressure: PressureUnitPref;
  locale: string;
}

// web useUnits derive* helpers: unit_of_temp 'F' -> '°F' else '°C';
// unit_of_pressure 'psi' -> 'psi' else 'bar'; empty locale -> 'en-US'.
function deriveTemperature(unitOfTemp: string | undefined): TemperatureUnitPref {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

function derivePressure(unitOfPressure: string | undefined): PressureUnitPref {
  return unitOfPressure === 'psi' ? 'psi' : 'bar';
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// Native bridge mirroring the web useUnits() unit-preference surface this widget
// reads (unitPrefs.temperature / unitPrefs.pressure), derived from the native
// useSettings() query exactly like the web hook.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  return {
    unitPrefs: {
      temperature: deriveTemperature(settings?.unit_of_temp),
      pressure: derivePressure(settings?.unit_of_pressure),
      locale: deriveLocale(settings?.locale),
    },
  };
}

/* ─── tinted glyph icon (web lucide-react Wifi/Cog/Thermometer/CircleDot) ─── */

function GlyphIcon({
  name,
  color,
  size,
}: {
  name: SemanticIconName;
  color: string;
  size: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// Computed once at render (no interval) to avoid a dangling timer under
// --detectOpenHandles.
function relativeTime(updatedAt: number): string {
  if (!updatedAt || updatedAt <= 0) {
    return 'never';
  }
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  let dotColor: string;
  if (isError) {
    label = 'Error';
    dotColor = colors.danger;
  } else if (isFetching) {
    label = 'Updating…';
    dotColor = colors.accent;
  } else if (isStale) {
    label = 'Stale';
    dotColor = colors.warning;
  } else {
    label = relativeTime(updatedAt);
    dotColor = colors.success;
  }

  return (
    <Pressable
      accessibilityLabel={`Data ${label}. Refresh.`}
      accessibilityRole="button"
      disabled={!onRefresh}
      onPress={onRefresh}
      style={styles.freshness}
      testID="widget-freshness">
      <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
      <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── WidgetShell (web ./WidgetShell, subset used by this widget) ─────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  const showFreshness = updatedAt !== undefined;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
      updatedAt={updatedAt ?? 0}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellTitleRow}>
            {icon}
            <AppText
              numberOfLines={1}
              style={styles.shellTitle}
              tone="muted"
              variant="caption">
              {title.toUpperCase()}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : (
        freshnessEl && (
          <View pointerEvents="box-none" style={styles.shellFreshnessOverlay}>
            {freshnessEl}
          </View>
        )
      )}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── @/components/ui Badge (pill) ───────────────────────────────────────── */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_PALETTE: Record<BadgeVariant, {bg: string; fg: string}> = {
  success: {bg: colors.successSurface, fg: colors.success},
  warning: {bg: colors.warningSurface, fg: colors.warning},
  danger: {bg: colors.dangerSurface, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, fg: colors.textMuted},
};

function Badge({
  variant = 'neutral',
  children,
  testID,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  testID?: string;
}) {
  const palette = BADGE_PALETTE[variant];
  return (
    <View style={[styles.badge, {backgroundColor: palette.bg}]} testID={testID}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── section header (web <h4> uppercase muted row) ──────────────────────── */

function SectionHeader({icon, label}: {icon: ReactNode; label: string}) {
  return (
    <View style={styles.sectionHeader}>
      {icon}
      <AppText numberOfLines={1} style={styles.sectionHeaderText} tone="muted">
        {label.toUpperCase()}
      </AppText>
    </View>
  );
}

/* ─── Row (ported from the source) ───────────────────────────────────────── */

function Row({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.row}>
      <AppText numberOfLines={1} style={styles.rowLabel} tone="secondary">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.rowValue}>
        {value}
      </AppText>
    </View>
  );
}

/* ─── LiveSignalsWidget ──────────────────────────────────────────────────── */

export default function LiveSignalsWidget({vehicleId}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const opts = {enabled: id > 0, refetchInterval: 5_000} as const;

  const {
    data: motor,
    isFetching: motorFetching,
    isStale: motorStale,
    isError: motorError,
    dataUpdatedAt: motorUpdatedAt,
    refetch: refetchMotor,
  } = useMotorLatest(id, opts.refetchInterval);
  const {data: climate} = useClimateLatest(id, opts.refetchInterval);
  const {data: security} = useSecurityLatest(id, opts.refetchInterval);
  const {data: tires} = useLatestTirePressure(id, opts.refetchInterval);
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const pressureUnit = unitPrefs.pressure;
  const toPressureDisplay = (value: number) =>
    convertPressureFromSI(value, unitPrefs.pressure);
  const locale = unitPrefs.locale;

  const hasData = motor || climate || security || tires;

  return (
    <WidgetShell
      title={t('widget.liveSignals', 'Live Signals')}
      icon={<GlyphIcon color={colors.accent} name="wifi" size={13} />}
      updatedAt={motorUpdatedAt}
      isFetching={motorFetching}
      isStale={motorStale}
      isError={motorError}
      onRefresh={() => refetchMotor()}>
      {!hasData ? (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={<GlyphIcon color={colors.textSecondary} name="wifi" size={18} />}
          message={t('widget.noSignals', 'No live signal data')}
          style={styles.emptyState}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.grid}
          style={styles.gridScroll}>
          {/* Drivetrain */}
          <View style={styles.section}>
            <SectionHeader
              icon={<GlyphIcon color={colors.violet} name="settings" size={11} />}
              label={t('widget.motor', 'Motor')}
            />
            {motor ? (
              <>
                <Row
                  label={t('widget.torque', 'Torque')}
                  value={motor.di_torque != null ? `${motor.di_torque} Nm` : '—'}
                />
                <Row
                  label={t('widget.motorTemp', 'Temp')}
                  value={
                    motor.di_stator_temp != null
                      ? `${fmtInt(
                          toTemperatureDisplay(motor.di_stator_temp),
                          locale,
                        )}${tempUnit}`
                      : '—'
                  }
                />
                <Row
                  label={t('widget.gear', 'Gear')}
                  value={cleanNil(motor.gear) ?? '—'}
                />
              </>
            ) : (
              <Skeleton height={48} />
            )}
          </View>

          {/* Climate */}
          <View style={styles.section}>
            <SectionHeader
              icon={<GlyphIcon color={colors.accent} name="climate" size={11} />}
              label={t('widget.climate', 'Climate')}
            />
            {climate ? (
              <>
                <Row
                  label={t('widget.cabin', 'Cabin')}
                  value={
                    climate.inside_temp != null
                      ? `${fmtInt(
                          toTemperatureDisplay(climate.inside_temp),
                          locale,
                        )}${tempUnit}`
                      : '—'
                  }
                />
                <Row
                  label={t('widget.outside', 'Outside')}
                  value={
                    climate.outside_temp != null
                      ? `${fmtInt(
                          toTemperatureDisplay(climate.outside_temp),
                          locale,
                        )}${tempUnit}`
                      : '—'
                  }
                />
                <Row
                  label={t('widget.hvac', 'HVAC')}
                  value={
                    climate.hvac_power != null
                      ? `${fmtNumber(climate.hvac_power, 1, locale)} kW`
                      : '—'
                  }
                />
              </>
            ) : (
              <Skeleton height={48} />
            )}
          </View>

          {/* Tires */}
          <View style={styles.section}>
            <SectionHeader
              icon={
                <GlyphIcon color={colors.accent} name="tirePressure" size={11} />
              }
              label={t('widget.tires', 'Tires')}
            />
            {tires ? (
              <>
                <Row
                  label="FL"
                  value={
                    tires.front_left != null
                      ? `${fmtNumber(
                          toPressureDisplay(tires.front_left),
                          1,
                          locale,
                        )} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="FR"
                  value={
                    tires.front_right != null
                      ? `${fmtNumber(
                          toPressureDisplay(tires.front_right),
                          1,
                          locale,
                        )} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="RL"
                  value={
                    tires.rear_left != null
                      ? `${fmtNumber(
                          toPressureDisplay(tires.rear_left),
                          1,
                          locale,
                        )} ${pressureUnit}`
                      : '—'
                  }
                />
                <Row
                  label="RR"
                  value={
                    tires.rear_right != null
                      ? `${fmtNumber(
                          toPressureDisplay(tires.rear_right),
                          1,
                          locale,
                        )} ${pressureUnit}`
                      : '—'
                  }
                />
              </>
            ) : (
              <Skeleton height={48} />
            )}
          </View>

          {/* Security summary */}
          <View style={styles.section}>
            <SectionHeader
              icon={<AppText style={styles.shieldEmoji}>🛡️</AppText>}
              label={t('widget.security', 'Security')}
            />
            {security ? (
              <>
                <View style={styles.row}>
                  <AppText style={styles.rowLabel} tone="secondary">
                    {t('widget.lock', 'Lock')}
                  </AppText>
                  <Badge variant={security.locked ? 'success' : 'danger'}>
                    {security.locked
                      ? t('widget.locked', 'Locked')
                      : t('widget.unlocked', 'Unlocked')}
                  </Badge>
                </View>
                <View style={styles.row}>
                  <AppText style={styles.rowLabel} tone="secondary">
                    {t('widget.sentry', 'Sentry')}
                  </AppText>
                  <Badge variant={security.sentry_mode ? 'success' : 'neutral'}>
                    {security.sentry_mode
                      ? t('widget.active', 'Active')
                      : t('widget.off', 'Off')}
                  </Badge>
                </View>
              </>
            ) : (
              <Skeleton height={48} />
            )}
          </View>
        </ScrollView>
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // WidgetShell
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // DataFreshness
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  freshnessLabel: {
    fontSize: 10,
  },
  // EmptyState
  emptyState: {
    paddingVertical: spacing.md,
  },
  // Grid (web grid-cols-2 gap-4 overflow-y-auto)
  gridScroll: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  section: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 6,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  sectionHeaderText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  shieldEmoji: {
    fontSize: 12,
    lineHeight: 14,
  },
  // Row
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: 10,
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    maxWidth: 100,
  },
  // Badge
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
});
