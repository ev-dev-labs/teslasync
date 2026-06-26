// TripDetailPage — native parity port of
// web/src/features/trips/pages/TripDetailPage.tsx.
//
// A single trip's detail screen: a page header (title + trip-name subtitle), an
// opt-in AI trip-name suggestion panel, a 4-tile stat grid (Distance / Energy
// Used / Efficiency / Cost) and a metadata GlassPanel rendering a KVList
// (Trip ID / Name / Started / Ended / Drives / Charges). Every state name,
// API path, SI-meter/SI-Wh unit handling, the inline Wh/km->Wh/mi efficiency
// factor, the i18n key + English fallback, and the loading/error/not-found
// branching is preserved verbatim from the web source.
//
// Native adaptations vs. the web source (rule 7 — browser-only behaviour
// replaced, documented; behaviour / state / keys / units otherwise kept):
//   - react-router-dom useParams `/trips/:id` (web L1) -> no RN router: the
//     trip id arrives via an optional `id` prop. When omitted, useTrip is
//     disabled (enabled: !!id) and the page renders the same "Trip not found"
//     EmptyState the web shows for a missing/!trip result.
//   - react-i18next useTranslation (web L2) -> native-safe t(key, fallback)
//     (no i18n runtime in RN; the source only ever passes key + English
//     fallback, never interpolation).
//   - @/components/layout PageContainer + Grid (web L3-4) -> inline RN
//     PageContainer (single ScrollView; loading -> ActivityIndicator only,
//     error -> error box only, else children — mirroring the web spinner/
//     error/children branching) + inline RN Grid (2-up flex-wrap row, matching
//     the web `cols={{default:2,lg:4}}` mobile breakpoint). The web
//     `breadcrumbLabels` prop is dropped (no RN router/breadcrumb context).
//   - @/components/ui GlassPanel (web L5) -> the canonical native GlassPanel.
//   - @/components/data-display StatCard + KVList (web L6) -> the canonical
//     native KVList + an inline RN StatCard (label / value / unit), there being
//     no standalone native StatCard file.
//   - @/components/feedback EmptyState (web L7) -> inline RN EmptyState.
//   - @/components/ai/AIAutoTripNameSuggestion (web L8) -> the already-converted
//     native sibling (renders null unless the AI feature is enabled, matching
//     the web withAiFeature gating).
//   - @/api/hooks/useTrips useTrip (web L9) -> native ../../../api/hooks/useTrips
//     useTrip (identical `/trips/{id}` path + enabled: !!id contract).
//   - @/hooks useUnits / useFormatting (web L10-11) -> inline native shims that
//     read the native useSettings (unitPrefs.distance from unit_of_length;
//     formatCurrency from currency_symbol + decimal_precision) — only the two
//     members this page uses are ported.
//   - @/lib convertDistanceFromSI / formatDate / fmtNumber / fmtInt (web L12-14)
//     -> ported inline (en-US locale, default precision 2 — the web default
//     global precision; formatCurrency still honours settings.decimal_precision
//     exactly as the web useFormatting does).
//
// No DOM/Recharts/Leaflet/react-router/react-i18next/old-web-UI import reaches
// the native output — only react, react-native primitives (ActivityIndicator/
// ScrollView/StyleSheet/View), the canonical AppText/GlassPanel/KVList + theme
// tokens, the already-native AIAutoTripNameSuggestion, and the native trips/
// settings hooks.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {AIAutoTripNameSuggestion} from '../../../components/ai/AIAutoTripNameSuggestion';
import {KVList} from '../../../components/data-display/KVList';
import {useSettings} from '../../../api/hooks/useSettings';
import {useTrip} from '../../../api/hooks/useTrips';

// Wh/km -> Wh/(display unit) conversion uses an inline factor because
// @/lib/unitConversion does not yet expose a convertEfficiencyFromSI
// helper. Same precedent as FleetComparePage.whPerKmToDisplay.
const KM_PER_MILE = 1.609344;

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useTranslation(): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>((_key, fallback) => fallback, []);
  return {t};
}

// ---- numberFormat (web @/lib/numberFormat), en-US, default precision 2 ------

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ---- dateFormat (web @/lib/dateFormat formatDate) ---------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---- unitConversion (web @/lib/unitConversion convertDistanceFromSI) --------

type DistanceUnitPref = 'km' | 'mi';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// ---- useUnits / useFormatting (web @/hooks) ---------------------------------

interface UnitPrefsLite {
  distance: DistanceUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const unitPrefs = useMemo<UnitPrefsLite>(() => ({distance}), [distance]);
  return {unitPrefs};
}

interface UseFormattingResult {
  formatCurrency: (amount: number, decimals?: number) => string;
}

function useFormatting(): UseFormattingResult {
  const {data} = useSettings();
  const currencySymbol =
    data?.currency_symbol && data.currency_symbol.trim() ? data.currency_symbol : '$';
  const userPrecision =
    typeof data?.decimal_precision === 'number' &&
    Number.isFinite(data.decimal_precision) &&
    data.decimal_precision >= 0
      ? Math.floor(data.decimal_precision)
      : 2;
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );
  return useMemo(() => ({formatCurrency}), [formatCurrency]);
}

// ---- PageContainer (web @/components/layout) --------------------------------

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  children?: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  children,
}: PageContainerProps): React.ReactElement {
  return (
    <ScrollView style={styles.pageRoot} contentContainerStyle={styles.pageContent}>
      <View style={styles.pageHeader}>
        <AppText variant="display" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText tone="muted" style={styles.pageSubtitle}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <AppText style={styles.errorText}>{error.message}</AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

// ---- Grid (web @/components/layout) -----------------------------------------

function Grid({children}: {children: ReactNode}): React.ReactElement {
  return <View style={styles.grid}>{children}</View>;
}

// ---- StatCard (web @/components/data-display) -------------------------------

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
}

function StatCard({label, value, unit}: StatCardProps): React.ReactElement {
  return (
    <GlassPanel style={styles.statCard}>
      <AppText style={styles.statLabel}>{label}</AppText>
      <View style={styles.statValueRow}>
        <AppText style={styles.statValue}>{value}</AppText>
        {unit ? (
          <AppText tone="muted" style={styles.statUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
    </GlassPanel>
  );
}

// ---- EmptyState (web @/components/feedback) ---------------------------------

function EmptyState({message}: {message: string}): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ---- Page -------------------------------------------------------------------

interface TripDetailPageProps {
  /** Native param source (web reads useParams `/trips/:id`). Optional: when
   *  omitted the trip query is disabled and the not-found state renders. */
  id?: string;
}

export default function TripDetailPage({
  id,
}: TripDetailPageProps = {}): React.ReactElement {
  const {t} = useTranslation();
  const {data: trip, isLoading, error} = useTrip(id ?? '');
  const {unitPrefs} = useUnits();
  const {formatCurrency} = useFormatting();
  // Numeric efficiency conversion runs through KM_PER_MILE until
  // @/lib/unitConversion exposes a convertEfficiencyFromSI helper.

  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';

  const whPerKm =
    trip && trip.total_distance_m > 0
      ? trip.total_energy_wh / (trip.total_distance_m / 1000)
      : 0;
  const efficiencyDisplay =
    unitPrefs.distance === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  return (
    <PageContainer
      title={t('trips.detail.title', 'Trip Detail')}
      subtitle={trip ? trip.name ?? `Trip #${trip.id}` : undefined}
      loading={isLoading}
      error={error instanceof Error ? error : null}>
      {trip ? (
        <View style={styles.body}>
          <AIAutoTripNameSuggestion tripId={id} />

          <Grid>
            <StatCard
              label={t('trips.detail.distance', 'Distance')}
              value={fmtInt(
                convertDistanceFromSI(trip.total_distance_m, unitPrefs.distance),
              )}
              unit={unitPrefs.distance}
            />
            <StatCard
              label={t('trips.detail.energy', 'Energy Used')}
              value={fmtNumber(trip.total_energy_wh)}
              unit="Wh"
            />
            <StatCard
              label={t('trips.detail.efficiency', 'Efficiency')}
              value={fmtInt(efficiencyDisplay)}
              unit={efficiencyUnit}
            />
            <StatCard
              label={t('trips.detail.cost', 'Cost')}
              value={formatCurrency(trip.total_cost)}
            />
          </Grid>

          <GlassPanel style={styles.metaPanel}>
            <KVList
              items={[
                {
                  label: t('trips.detail.tripId', 'Trip ID'),
                  value: String(trip.id),
                },
                {label: t('trips.detail.name', 'Name'), value: trip.name ?? '—'},
                {
                  label: t('trips.detail.started', 'Started'),
                  value: formatDate(trip.start_date),
                },
                {
                  label: t('trips.detail.ended', 'Ended'),
                  value: trip.end_date ? formatDate(trip.end_date) : '—',
                },
                {
                  label: t('trips.detail.drives', 'Drives'),
                  value: String(trip.drive_count),
                },
                {
                  label: t('trips.detail.charges', 'Charges'),
                  value: String(trip.charge_count),
                },
              ]}
            />
          </GlassPanel>
        </View>
      ) : (
        <EmptyState message={t('trips.detail.notFound', 'Trip not found')} />
      )}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.lg,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  metaPanel: {
    padding: spacing.lg,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageSubtitle: {
    fontSize: 14,
  },
  statCard: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 150,
    padding: spacing.lg,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  statUnit: {
    fontSize: 14,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  statValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
