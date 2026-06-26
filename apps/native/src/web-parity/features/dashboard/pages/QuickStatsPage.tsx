// Native parity port of web/src/features/dashboard/pages/QuickStatsPage.tsx.
//
// The web page is a compact, centered "Quick Stats" card view: a single
// PageContainer (centered via `min-h-screen flex flex-col items-center
// justify-center p-4`) holding three FadeIn-wrapped blocks -- a vehicle
// identity card (GlassPanel), a 1/2-column grid of four MetricCards
// (distance / drives / energy / cost), and a footer line with a react-router
// <Link to="/"> "Open Dashboard" CTA. Data comes from useVehicles +
// useVehicleState (first vehicle + its live state) and useAnalyticsSummary(30);
// values are unit/currency formatted via useUnits + useFormatting + the SI
// distance converter + fmtInt.
//
// Line-by-line coverage of the source:
//   L1-15   imports -> RN/shared-native equivalents; the DOM-only / web-UI /
//           lucide-react / react-router / settings-hook / lib imports are
//           replaced by native primitives, shared native components
//           (GlassPanel, SemanticIcon, AppText), the two existing native data
//           hooks (useVehicles/useVehicleState, useAnalyticsSummary), and
//           inlined native-safe ports of the small lib helpers (see below).
//   L17-19  default export + usePageTitle -> default export retained; the web
//           usePageTitle set document.title (no document on native) so it is a
//           documented no-op (useNativePageTitle); the title still renders in
//           the page header (parity for PageContainer's <h1>).
//   L21-22  useVehicles() / useAnalyticsSummary(30) -> same native hooks, same
//           destructured data/isLoading/error names, same `30` day window.
//   L23     useUnits().unitPrefs -> with no native settings store wired, the
//           distance preference resolves to its 'km' default (web derives 'mi'
//           only when settings.unit_of_length === 'mi'); documented below.
//   L24     useFormatting().formatCurrency -> inlined formatCurrency using the
//           same `${symbol}${fmtNumber(amount, decimals)}` shape and the '$'
//           default symbol (settings.currency_symbol default).
//   L26-29  isLoading / error / vehicle / useVehicleState(vehicle?.id ?? 0) ->
//           identical derivations and identical hook-call order.
//   L31-37  PageContainer(title, loading, error, centered className) ->
//           PageContainerView with the same title/loading/error semantics and
//           a centered scroll layout standing in for the centering classes.
//   L38     max-w-md column -> styles.column (maxWidth 448 = 28rem, width 100%).
//   L39-60  vehicle card -> GlassPanel; cyan Car-in-circle -> SemanticIcon
//           name="vehicle" (accent); display_name || 'Tesla'; `{model} ·
//           {state}` -> stateData?.state?.state ?? 'offline' (narrowed for the
//           native VehicleStateResult union); EmptyState(message) -> inline
//           message-only empty state.
//   L62-86  four MetricCards -> MetricCardView in a wrapped 2-col grid; the web
//           cards render no icon so `color` is visually inert there, but the
//           color intent is honored via a small accent dot (native MetricCard
//           convention). Same labels, same value expressions, same colors.
//   L67     fmtInt(convertDistanceFromSI(totalDistanceKm*1000, distance)) ->
//           inlined convertDistanceFromSI + fmtInt, identical math.
//   L88-96  footer + react-router <Link to="/"> -> centered caption; the link
//           is a nested pressable AppText calling the optional `onNavigate`
//           with QUICK_STATS_DASHBOARD_ROUTE_ID (native has no react-router).
//   L98-100 close tags / default export end.
//
// No DOM, no lucide-react, no Recharts/Leaflet, no react-router, no
// framer-motion, and no web UI components are imported.

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { useAnalyticsSummary } from '../../../api/hooks/useAnalytics';
import { useVehicles, useVehicleState } from '../../../api/hooks/useVehicles';

/* ------------------------------------------------------------------ */
/*  i18n + native-safe helpers (inlined web lib/hook ports)            */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

// The web page read `t` from react-i18next. Native parity has no i18n runtime
// wired yet, so this returns the English fallback and reproduces i18next's
// `{{var}}` interpolation, preserving every key, fallback, and the `unit`
// substitution used by the distance metric label.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  }, []);
}

// Native no-op for the web `usePageTitle` (which set `document.title`). There is
// no document on native; the page header still renders the title.
function useNativePageTitle(_title: string): void {
  // Intentionally empty -- see note above.
}

// Inlined from web `@/lib/numberFormat`: `fmtInt` == `fmtNumber(v, 0)`. The web
// global locale defaults to 'en-US' until useSettings overrides it; native has
// no useSettings wired here, so 'en-US' is the faithful default.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return String(safeNumber(v));
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// Inlined from web `useFormatting().formatCurrency`. The currency symbol and
// precision come from useSettings on web; with no native settings store the
// faithful defaults are '$' and precision 2 (callers pass explicit decimals).
const DEFAULT_CURRENCY_SYMBOL = '$';

function formatCurrency(amount: number, decimals = 2): string {
  return `${DEFAULT_CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`;
}

// Inlined from web `@/lib/unitConversion.convertDistanceFromSI` (SI meters ->
// display unit). Same exact constants and switch as the source.
type DistanceUnitPref = 'km' | 'mi' | 'ft';
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// Web `useUnits().unitPrefs.distance` derives from settings.unit_of_length,
// defaulting to 'km' when it is anything other than 'mi'. Native has no
// settings store wired here, so the distance preference is its 'km' default.
const DEFAULT_DISTANCE_PREF: DistanceUnitPref = 'km';

/* ------------------------------------------------------------------ */
/*  Navigation + capability surface                                    */
/* ------------------------------------------------------------------ */

/**
 * Route the web footer CTA linked to via react-router (`<Link to="/">`).
 * Surfaced as the native route id so the shell (or a test) can wire
 * {@link QuickStatsPageProps.onNavigate} to the equivalent navigation.
 */
export const QUICK_STATS_DASHBOARD_ROUTE_ID = '/';

/**
 * Records which web capabilities the source relied on that are unavailable on
 * native, so the unavailable state is explicit and programmatically
 * inspectable (parity-contract rule 7).
 */
export const nativeQuickStatsCapabilities = {
  // Web set document.title via usePageTitle; native has no document.
  documentTitleAvailable: false,
  // Web footer CTA was a react-router <Link>; native surfaces navigation via
  // the optional onNavigate callback instead.
  reactRouterLinkAvailable: false,
  // Web read unit/currency prefs from useSettings; native has no settings store
  // wired, so 'km' + '$' defaults are used (matching the web defaults).
  settingsStoreAvailable: false,
} as const;

export interface QuickStatsPageProps {
  /**
   * Navigation handler. Parity for the web `<Link to="/">`; callers should
   * route to {@link QUICK_STATS_DASHBOARD_ROUTE_ID}. Omitted -> the CTA is inert
   * (still rendered), matching how the native shell may not yet own a route
   * table.
   */
  onNavigate?: (routeId: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Local native parity components                                     */
/* ------------------------------------------------------------------ */

// Native parity for the shared web <FadeIn> motion wrapper. framer-motion is
// not available on native; the wrapper renders its children directly. `delay`
// is accepted to preserve the web call sites (delay={0.05}/{0.1}) but has no
// effect without an animation runtime.
function FadeIn({
  children,
}: {
  children: React.ReactNode;
  delay?: number;
}) {
  return <View>{children}</View>;
}

// Native parity for the web PageContainer used here: a centered scroll layout
// (standing in for `min-h-screen flex flex-col items-center justify-center p-4`)
// that renders the title header and switches between the web loading (Spinner)
// and error (red panel) states.
function PageContainerView({
  title,
  loading,
  error,
  children,
}: {
  title: string;
  loading?: boolean;
  error?: Error | null;
  children: React.ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.pageRoot}>
      <AppText style={styles.pageTitle} variant="title" weight="bold">
        {title}
      </AppText>
      {loading ? (
        <View style={styles.stateBlock}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorPanel}>
          <AppText style={styles.errorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

type MetricColor = 'cyan' | 'green' | 'amber' | 'purple';

// Native parity for the shared web <MetricCard> (label + value). The web card
// renders no icon here, so its `color` prop is visually inert in the source;
// the color intent is preserved via a small accent dot (native MetricCard
// convention) so the four cards stay distinguishable.
function MetricCardView({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: MetricColor;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricLabelRow}>
        <View style={[styles.metricDot, metricDotStyles[color]]} />
        <AppText
          numberOfLines={1}
          style={styles.metricLabel}
          tone="muted"
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      </View>
      <AppText style={styles.metricValue} weight="bold">
        {value}
      </AppText>
    </View>
  );
}

// Native parity for the web <EmptyState message=... />: a centered muted line.
function EmptyStateView({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <AppText tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function QuickStatsPage(props: QuickStatsPageProps = {}) {
  const { onNavigate } = props;
  const t = useNativeTranslationFallback();
  useNativePageTitle(t('quickStats.title', 'Quick Stats'));

  const {
    data: vehicles,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = useVehicles();
  const {
    data: analytics,
    isLoading: analyticsLoading,
    error: analyticsError,
  } = useAnalyticsSummary(30);
  const distanceUnit = DEFAULT_DISTANCE_PREF;

  const isLoading = vehiclesLoading || analyticsLoading;
  const error = vehiclesError || analyticsError;
  const vehicle = vehicles?.[0];
  const { data: stateData } = useVehicleState(vehicle?.id ?? 0);

  // Web read `stateData?.state?.state`. The native VehicleStateResult.state is a
  // `VehicleState | string | null` union (always the object shape at runtime
  // via normalizeVehicleStateResponse), so narrow before reading `.state`.
  const vehicleStateLabel =
    (stateData?.state && typeof stateData.state === 'object'
      ? stateData.state.state
      : typeof stateData?.state === 'string'
        ? stateData.state
        : undefined) ?? 'offline';

  const handleOpenDashboard = useCallback(() => {
    onNavigate?.(QUICK_STATS_DASHBOARD_ROUTE_ID);
  }, [onNavigate]);

  return (
    <PageContainerView
      error={error instanceof Error ? error : null}
      loading={isLoading}
      title={t('quickStats.title', 'Quick Stats')}>
      <View style={styles.column}>
        {/* Vehicle card */}
        <FadeIn>
          <GlassPanel style={styles.vehiclePanel}>
            {vehicle ? (
              <View style={styles.vehicleRow}>
                <SemanticIcon decorative name="vehicle" size="md" />
                <View style={styles.vehicleCopy}>
                  <AppText
                    numberOfLines={1}
                    style={styles.vehicleName}
                    weight="bold">
                    {vehicle.display_name || t('quickStats.defaultName', 'Tesla')}
                  </AppText>
                  <AppText numberOfLines={1} tone="muted" variant="caption">
                    {vehicle.model} · {vehicleStateLabel}
                  </AppText>
                </View>
              </View>
            ) : (
              <EmptyStateView
                message={t('quickStats.noVehicle', 'No vehicle found')}
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Key metrics */}
        <FadeIn delay={0.05}>
          <View style={styles.metricsGrid}>
            <MetricCardView
              color="cyan"
              label={t('quickStats.distance', '{{unit}} Driven', {
                unit: distanceUnit,
              })}
              value={fmtInt(
                convertDistanceFromSI(
                  (analytics?.totalDistanceKm ?? 0) * 1000,
                  distanceUnit,
                ),
              )}
            />
            <MetricCardView
              color="green"
              label={t('quickStats.drives', 'Drives')}
              value={analytics?.totalDrives ?? 0}
            />
            <MetricCardView
              color="amber"
              label={t('quickStats.energy', 'kWh Used')}
              value={fmtInt(analytics?.totalEnergyKwh ?? 0)}
            />
            <MetricCardView
              color="purple"
              label={t('quickStats.cost', 'Total Cost')}
              value={formatCurrency(analytics?.totalCost ?? 0, 0)}
            />
          </View>
        </FadeIn>

        {/* Footer */}
        <FadeIn delay={0.1}>
          <AppText style={styles.footer} tone="muted" variant="caption">
            {t('quickStats.footer', 'Powered by TeslaSync')} ·{' '}
            <AppText
              accessibilityRole="link"
              onPress={onNavigate ? handleOpenDashboard : undefined}
              style={styles.footerLink}
              suppressHighlighting>
              {t('quickStats.openDashboard', 'Open Dashboard')}
            </AppText>
          </AppText>
        </FadeIn>
      </View>
    </PageContainerView>
  );
}

QuickStatsPage.displayName = 'QuickStatsPage';

const FOOTER_FONT_SIZE = 10;

const styles = StyleSheet.create({
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    alignItems: 'center',
    flexGrow: 1,
    gap: spacing.lg,
    justifyContent: 'center',
    padding: spacing.md,
  },
  pageTitle: {
    textAlign: 'center',
  },
  stateBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorPanel: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
    width: '100%',
  },
  errorText: {
    color: colors.danger,
  },
  column: {
    gap: spacing.md,
    maxWidth: 448,
    width: '100%',
  },
  vehiclePanel: {
    padding: spacing.md,
  },
  vehicleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  vehicleCopy: {
    flex: 1,
    minWidth: 0,
  },
  vehicleName: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 22,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 150,
    padding: spacing.md,
  },
  metricLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  metricLabel: {
    flex: 1,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  footer: {
    fontSize: FOOTER_FONT_SIZE,
    lineHeight: 14,
    textAlign: 'center',
  },
  footerLink: {
    color: colors.accent,
    fontSize: FOOTER_FONT_SIZE,
    lineHeight: 14,
  },
});

const metricDotStyles = StyleSheet.create<Record<MetricColor, ViewStyle>>({
  cyan: {
    backgroundColor: colors.accent,
  },
  green: {
    backgroundColor: colors.success,
  },
  amber: {
    backgroundColor: colors.warning,
  },
  purple: {
    backgroundColor: colors.violet,
  },
});
