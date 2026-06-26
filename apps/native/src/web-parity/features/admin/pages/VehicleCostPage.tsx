// Native parity port of web/src/features/admin/pages/VehicleCostPage.tsx.
//
// The web module is the admin "Vehicle Ingest Cost" observability surface: a
// per-vehicle telemetry cost report (signal_log row count, estimated byte cost,
// 24h ingest rate, and DLQ failures). It renders a PageContainer (title +
// subtitle + a DataFreshness chip driven by the query) wrapping a FadeIn column
// that shows, in order: a "Subsystem unavailable" warning AlertBanner when the
// endpoint 503s, a four-up fleet-total StatCard grid (Total rows / Total bytes /
// Rate / DLQ failures) rendered only when `totals` is present, and a
// "Per-vehicle breakdown" GlassPanel whose header carries a PanelTitle plus a
// "Window" Select (1d / 7d / 30d / 90d) and whose body is either an EmptyState
// (no vehicles ingested in the window) or a sortable DataTable of
// VehicleCostRow rows (vehicle / rows / bytes / rate / DLQ / last-seen), wrapped
// in a SectionErrorBoundary. It is backed by GET
// /api/v1/admin/observability/vehicle-cost via useVehicleCost(since, 100).
//
// Native-safe substitutions (rule 5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallbackOrOptions?, values?) returns the English fallback (or the
//     `defaultValue`) and interpolates {{token}} placeholders, so every key +
//     copy string (incl. the {{id}}/{{days}} interpolations) is preserved
//     verbatim at the call site.
//   • usePageTitle(...) -> a native no-op hook (no document.title in RN); the
//     call site and its translated title key are preserved.
//   • The shared web <PageContainer> -> an inlined native PageContainer that
//     keeps the header (title/subtitle/actions) + loading/error/empty/children
//     branch semantics (this page passes only title/subtitle/query, so children
//     always render), wrapped in a ScrollView. Its `query` prop renders an
//     inlined DataFreshness chip: status is error > fetching > stale > fresh,
//     with the same relative-time / "updating…" / "error" label logic. The
//     web's 30s re-render interval is dropped (the label is computed once at
//     render) to avoid a dangling timer under --detectOpenHandles; the icon
//     glyphs collapse to a tone-coloured status dot.
//   • The lucide-react Wallet glyph -> the native SemanticIcon registry
//     ("wallet").
//   • The shared web <GlassPanel>/<Select>/<DataTable>/<StatCard>/<PanelTitle>/
//     <Caption>/<EmptyState>/<AlertBanner>/<SectionErrorBoundary> + <FadeIn> ->
//     the ported native GlassPanel/AppText/FadeIn/AlertBanner/EmptyState plus
//     inlined native Select (a labelled row of pressable option chips whose
//     onChange yields the chosen value, mirroring the web `e.target.value`
//     payload), DataTable (with `align: 'right'` cell support to mirror the web
//     column alignment), StatCard (label / 2xl value / muted sublabel),
//     PanelTitle, Caption, and a real native error-boundary class.
//   • @/lib formatters (fmtNumber / formatBytes / formatRelative) -> inlined
//     verbatim. fmtNumber keeps the web module's default decimal precision of 2
//     and explicit per-call overrides (the rate columns pass 1). formatBytes
//     keeps the binary-unit ladder (B / KB / MB / GB) and the "—" fallback.
//   • @/lib/resilience isApiError -> the already-ported isApiError from the
//     native api/client (same name + status contract); the 503 subsystem-missing
//     branch is preserved.
//   • @/types/admin-operator-confidence VehicleCostRow -> the identical type is
//     colocated in (and imported from) the ported useOperatorConfidence hook
//     module; the FleetTotalsCards `totals` prop preserves the source's exact
//     `NonNullable<ReturnType<typeof useVehicleCost>['data']>['totals']`
//     inference so no concrete totals type needs importing.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys), and the API path / query key are preserved by the ported hook.
// keyExtractor returns String(r.vehicle_id) because the native DataTable typed
// its key as a string (React keys coerce to string regardless).
// No DOM elements, react-i18next, lucide-react, framer-motion, Recharts, Leaflet,
// react-dom, or web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  useVehicleCost,
  type VehicleCostRow,
} from '../../../api/hooks/useOperatorConfidence';
import {isApiError} from '../../../api/client';
import {FadeIn} from '../../../components/motion/FadeIn';
import {AlertBanner} from '../../../components/feedback/AlertBanner';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (web react-i18next useTranslation)                   */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number | null | undefined>;
type TOptions = TVars & {defaultValue?: string};
type TFunc = (key: string, arg2?: string | TOptions, arg3?: TVars) => string;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or `defaultValue`) while
// preserving every key at the call site, with {{token}} interpolation kept.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, arg2, arg3) => {
    let fallback = key;
    let vars: TVars | undefined;
    if (typeof arg2 === 'string') {
      fallback = arg2;
      vars = arg3;
    } else if (arg2 && typeof arg2 === 'object') {
      const {defaultValue, ...rest} = arg2;
      fallback = defaultValue ?? key;
      vars = rest as TVars;
    }
    return interpolate(fallback, vars);
  }, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ------------------------------------------------------------------ */
/*  Inlined @/lib formatters                                           */
/* ------------------------------------------------------------------ */

// Web @/lib/numberFormat fmtNumber default precision is 2; en-US is used for
// deterministic output (the SecretRotationPage en-US precedent).
const DEFAULT_PRECISION = 2;

function fmtNumber(value: number, decimals: number = DEFAULT_PRECISION): string {
  const safe = Number.isFinite(value) ? value : 0;
  try {
    return safe.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safe.toFixed(decimals);
  }
}

// Web @/lib/numberFormat formatBytes: binary-unit ladder with a "—" fallback for
// nullish / non-finite input. The page calls it with default options.
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Web @/lib/dateFormat formatDate: "Apr 4, 2026" with a "—" fallback.
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d.toISOString();
  }
}

// Web @/lib/dateFormat formatRelative: "just now", "5m ago", "2h ago", "3d ago",
// then falls back to the absolute date. "—" for missing / invalid input.
function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
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
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso);
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui/Typography PanelTitle + Caption            */
/* ------------------------------------------------------------------ */

// Web PanelTitle (Heading level="panel" — base/semibold/primary). The web call
// site adds no margin (the bottom gap lives on the wrapping header row).
function PanelTitle({children}: {children: ReactNode}): React.ReactElement {
  return (
    <AppText style={styles.panelTitleText} weight="semibold">
      {children}
    </AppText>
  );
}

// Web Caption (Text variant="caption" — small muted body).
function Caption({children}: {children: ReactNode}): React.ReactElement {
  return (
    <AppText style={styles.captionText} tone="muted" variant="caption">
      {children}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display StatCard                         */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
}

// Web StatCard: a Card with a muted label, a 2xl-bold value, and an optional
// muted sublabel. The loading/unit/trend/icon props the web exposes are unused
// by this page and are omitted from the native surface.
function StatCard({label, value, sublabel}: StatCardProps): React.ReactElement {
  return (
    <View style={styles.statCard}>
      <AppText numberOfLines={1} style={styles.statCardLabel} tone="muted">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.statCardValue}>
        {value}
      </AppText>
      {sublabel ? (
        <AppText
          numberOfLines={1}
          style={styles.statCardSublabel}
          tone="muted"
          variant="caption">
          {sublabel}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Select                                     */
/* ------------------------------------------------------------------ */

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

// Web <Select> (native <select>) -> a row of pressable option chips (the
// selected chip is accent-tinted). onChange receives the chosen option value,
// mirroring the web `e.target.value` payload.
function Select({
  label,
  options,
  value,
  onChange,
}: SelectProps): React.ReactElement {
  return (
    <View style={styles.field}>
      {label ? (
        <AppText style={styles.fieldLabel} tone="muted">
          {label}
        </AppText>
      ) : null}
      <View style={styles.optionRow}>
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.option,
                active ? styles.optionActive : null,
                pressed ? styles.optionPressed : null,
              ]}>
              <AppText
                style={active ? styles.optionTextActive : styles.optionText}
                weight={active ? 'semibold' : 'regular'}>
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui DataTable                                  */
/* ------------------------------------------------------------------ */

interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  emptyMessage?: string;
}

function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  emptyMessage,
}: DataTableProps<T>): React.ReactElement {
  if (data.length === 0) {
    return (
      <View accessibilityRole="text" style={styles.tableEmpty}>
        <AppText style={styles.tableEmptyText} tone="muted">
          {emptyMessage ?? 'No data'}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.table} testID={tableId}>
      <View style={[styles.tableRow, styles.headerRow]}>
        {columns.map(col => (
          <View
            key={col.key}
            style={[styles.cell, col.align === 'right' ? styles.cellRight : null]}>
            <AppText
              numberOfLines={1}
              style={styles.headerText}
              tone="muted"
              weight="semibold">
              {col.header}
            </AppText>
          </View>
        ))}
      </View>

      {data.map(row => (
        <View key={keyExtractor(row)} style={[styles.tableRow, styles.bodyRow]}>
          {columns.map(col => (
            <View
              key={col.key}
              style={[styles.cell, col.align === 'right' ? styles.cellRight : null]}>
              {col.render(row)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display DataFreshness (Auto)             */
/* ------------------------------------------------------------------ */

interface FreshnessQuery {
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
}

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

// Web DataFreshness local relative-time label (i18n-aware, distinct from the
// shared formatRelative helper): "just now" / "{{m}}m ago" / … / "{{w}}w ago".
function formatFreshnessTime(ms: number, t: TFunc): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function DataFreshness({query}: {query: FreshnessQuery}): React.ReactElement {
  const {t} = useTranslation();
  const status: FreshnessStatus = query.isError
    ? 'error'
    : query.isFetching
      ? 'fetching'
      : query.isStale
        ? 'stale'
        : 'fresh';
  const dot = FRESHNESS_DOT[status];
  const updatedAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;
  const label =
    updatedAt && !query.isFetching
      ? formatFreshnessTime(updatedAt, t)
      : query.isFetching
        ? t('freshness.updating', 'updating…')
        : query.isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <View
      accessibilityLabel={t('a11y.dataFreshness', 'Data freshness: {{state}}', {
        state: status,
      })}
      accessibilityRole="text"
      style={styles.freshness}>
      <View style={[styles.freshnessDot, {backgroundColor: dot}]} />
      {label ? (
        <AppText style={[styles.freshnessText, {color: dot}]}>{label}</AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/layout PageContainer                          */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  query?: FreshnessQuery;
  children: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  empty,
  emptyMessage,
  query,
  children,
}: PageContainerProps): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {query || actions ? (
          <View style={styles.pageActions}>
            {query ? <DataFreshness query={query} /> : null}
            {actions}
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.pageLoading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.pageErrorBox}>
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : empty ? (
        <View style={styles.pageEmpty}>
          <AppText tone="muted" variant="caption">
            {emptyMessage ?? `No ${title.toLowerCase()} found.`}
          </AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback SectionErrorBoundary                 */
/* ------------------------------------------------------------------ */

interface SectionErrorBoundaryProps {
  name: string;
  children: ReactNode;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
}

// Web SectionErrorBoundary wraps a section in an ErrorBoundary so a render
// failure inside it doesn't blank the whole page. RN function components can't
// catch render errors, so this is a real class boundary; the default inline
// fallback (message + "other parts still work" + Retry) mirrors the web inline
// UI. `name` is retained for parity (the web uses it for log correlation).
class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return {hasError: true};
  }

  private readonly handleRetry = (): void => {
    this.setState({hasError: false});
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View
          accessibilityRole="alert"
          style={styles.sectionError}
          testID={`section-error-${this.props.name}`}>
          <AppText style={styles.sectionErrorTitle} weight="semibold">
            Something went wrong in this section.
          </AppText>
          <AppText style={styles.sectionErrorSubtitle} tone="muted" variant="caption">
            Other parts of the page should still work.
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={this.handleRetry}
            style={({pressed}) => [
              styles.sectionRetry,
              pressed ? styles.sectionRetryPressed : null,
            ]}>
            <AppText style={styles.sectionRetryText} weight="semibold">
              Retry
            </AppText>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/*  Window options (verbatim from the source)                         */
/* ------------------------------------------------------------------ */

const WINDOW_OPTIONS: ReadonlyArray<{
  days: number;
  labelKey: string;
  fallback: string;
}> = [
  {days: 1, labelKey: 'admin.vehicleCost.window1d', fallback: 'Last 1 day'},
  {days: 7, labelKey: 'admin.vehicleCost.window7d', fallback: 'Last 7 days'},
  {days: 30, labelKey: 'admin.vehicleCost.window30d', fallback: 'Last 30 days'},
  {days: 90, labelKey: 'admin.vehicleCost.window90d', fallback: 'Last 90 days'},
];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function VehicleCostPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('admin.vehicleCost.pageTitle', 'Vehicle Ingest Cost'));

  const [windowDays, setWindowDays] = useState<number>(30);
  const since = useMemo(
    () => new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000),
    [windowDays],
  );

  const query = useVehicleCost(since, 100);
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const vehicles = query.data?.vehicles ?? [];
  const totals = query.data?.totals;

  const columns = useMemo<Column<VehicleCostRow>[]>(
    () => [
      {
        key: 'vehicle',
        header: t('admin.vehicleCost.colVehicle', 'Vehicle'),
        render: r => (
          <View style={styles.stackTight}>
            <AppText style={styles.nameText}>
              {r.display_name ??
                t('admin.vehicleCost.unnamed', 'Vehicle #{{id}}', {
                  id: r.vehicle_id,
                })}
            </AppText>
            <Caption>ID {fmtNumber(r.vehicle_id)}</Caption>
          </View>
        ),
      },
      {
        key: 'rows',
        header: t('admin.vehicleCost.colRows', 'Rows'),
        align: 'right',
        render: r => (
          <AppText style={styles.tabular}>{fmtNumber(r.signal_row_count)}</AppText>
        ),
      },
      {
        key: 'bytes',
        header: t('admin.vehicleCost.colBytes', 'Bytes (est.)'),
        align: 'right',
        render: r => (
          <AppText style={styles.tabular}>{formatBytes(r.signal_bytes_est)}</AppText>
        ),
      },
      {
        key: 'rate',
        header: t('admin.vehicleCost.colRate', 'Rate (rows/min, 24h)'),
        align: 'right',
        render: r => (
          <AppText style={styles.tabular}>
            {fmtNumber(r.ingest_rate_per_minute_24h, 1)}
          </AppText>
        ),
      },
      {
        key: 'failures',
        header: t('admin.vehicleCost.colFailures', 'DLQ (24h)'),
        align: 'right',
        render: r => {
          const failures = r.dlq_failures_24h ?? 0;
          return (
            <AppText
              style={[
                styles.tabular,
                failures > 0 ? styles.failuresWarn : styles.failuresMuted,
              ]}>
              {fmtNumber(failures)}
            </AppText>
          );
        },
      },
      {
        key: 'last',
        header: t('admin.vehicleCost.colLastSeen', 'Last seen'),
        render: r => (
          <AppText style={styles.tableText}>{formatRelative(r.last_seen_at)}</AppText>
        ),
      },
    ],
    [t],
  );

  return (
    <PageContainer
      title={t('admin.vehicleCost.pageTitle', 'Vehicle Ingest Cost')}
      subtitle={t(
        'admin.vehicleCost.subtitle',
        'Per-vehicle telemetry cost over the selected window. Use this to spot vehicles whose ingest volume is disproportionate to the fleet baseline.',
      )}
      query={query}>
      <FadeIn>
        <View style={styles.contentStack}>
          {subsystemMissing ? (
            <AlertBanner
              title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}
              variant="warning">
              {t(
                'admin.vehicleCost.notConfigured',
                'The ingest-x-ray subsystem is not configured on this deployment. Vehicle cost reporting requires the signal_log hypertable to be populated.',
              )}
            </AlertBanner>
          ) : null}

          {totals ? (
            <FleetTotalsCards totals={totals} windowDays={windowDays} />
          ) : null}

          <GlassPanel style={styles.panel}>
            <View style={styles.tableHeader}>
              <PanelTitle>
                {t('admin.vehicleCost.tableTitle', 'Per-vehicle breakdown')}
              </PanelTitle>
              <View style={styles.windowControl}>
                <Caption>{t('admin.vehicleCost.windowLabel', 'Window')}</Caption>
                <Select
                  value={String(windowDays)}
                  onChange={value => setWindowDays(Number(value))}
                  options={WINDOW_OPTIONS.map(opt => ({
                    value: String(opt.days),
                    label: t(opt.labelKey, opt.fallback),
                  }))}
                />
              </View>
            </View>
            <SectionErrorBoundary name="vehicle-cost-table">
              {vehicles.length === 0 && !query.isLoading && !subsystemMissing ? (
                // no-action: vehicles populate this view by ingesting telemetry;
                // not a user-actionable surface
                <EmptyState
                  icon={<SemanticIcon decorative name="wallet" size="lg" />}
                  message={t(
                    'admin.vehicleCost.emptyMessage',
                    'No vehicles have ingested signals during this window.',
                  )}
                  title={t('admin.vehicleCost.emptyTitle', 'No vehicle cost data')}
                />
              ) : (
                <DataTable
                  columns={columns}
                  data={vehicles}
                  emptyMessage={t(
                    'admin.vehicleCost.emptyTable',
                    'No vehicle cost data',
                  )}
                  keyExtractor={r => String(r.vehicle_id)}
                  tableId="admin:vehicle-cost"
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </View>
      </FadeIn>
    </PageContainer>
  );
}

interface FleetTotalsCardsProps {
  totals: NonNullable<ReturnType<typeof useVehicleCost>['data']>['totals'];
  windowDays: number;
}

function FleetTotalsCards({
  totals,
  windowDays,
}: FleetTotalsCardsProps): React.ReactElement {
  const {t} = useTranslation();
  return (
    <View style={styles.statsGrid}>
      <View style={styles.statCell}>
        <StatCard
          label={t('admin.vehicleCost.totalRows', 'Total rows')}
          sublabel={t('admin.vehicleCost.windowSub', 'Window: {{days}}d', {
            days: windowDays,
          })}
          value={fmtNumber(totals.total_rows)}
        />
      </View>
      <View style={styles.statCell}>
        <StatCard
          label={t('admin.vehicleCost.totalBytes', 'Total bytes (est.)')}
          sublabel={t('admin.vehicleCost.bytesSub', '96 bytes/row average')}
          value={formatBytes(totals.total_bytes_est)}
        />
      </View>
      <View style={styles.statCell}>
        <StatCard
          label={t('admin.vehicleCost.totalRate', 'Rate (rows/min, 24h)')}
          sublabel={t('admin.vehicleCost.rateSub', 'Across all vehicles')}
          value={fmtNumber(totals.total_rate_per_minute_24h, 1)}
        />
      </View>
      <View style={styles.statCell}>
        <StatCard
          label={t('admin.vehicleCost.totalFailures', 'DLQ failures (24h)')}
          sublabel={t('admin.vehicleCost.failuresSub', 'Codec or writer rejections')}
          value={fmtNumber(totals.total_failures_24h)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* page container */
  page: {backgroundColor: colors.background, flex: 1},
  pageContent: {gap: spacing.lg, padding: spacing.lg},
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderText: {flex: 1, minWidth: 180},
  pageTitle: {color: colors.textPrimary, fontSize: 24, lineHeight: 30},
  pageSubtitle: {fontSize: 13, lineHeight: 18, marginTop: spacing.xs},
  pageActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pageLoading: {alignItems: 'center', justifyContent: 'center', paddingVertical: 80},
  pageErrorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  pageErrorText: {color: colors.danger, fontSize: 13, lineHeight: 18},
  pageEmpty: {alignItems: 'center', justifyContent: 'center', paddingVertical: 64},

  /* data-freshness chip */
  freshness: {alignItems: 'center', flexDirection: 'row', gap: 4},
  freshnessDot: {borderRadius: 3, height: 6, width: 6},
  freshnessText: {fontSize: 10, lineHeight: 12, opacity: 0.7},

  /* page body */
  contentStack: {gap: 24},

  /* stats grid */
  statsGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md},
  statCell: {flexBasis: '46%', flexGrow: 1, minWidth: 150},
  statCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statCardLabel: {fontSize: 13, fontWeight: '500', lineHeight: 18},
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  statCardSublabel: {fontSize: 12, lineHeight: 16},

  /* panel */
  panel: {padding: spacing.lg},
  panelTitleText: {color: colors.textPrimary, fontSize: 16, lineHeight: 22},
  tableHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  windowControl: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },

  /* select option chips */
  field: {gap: spacing.xs},
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  optionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs},
  option: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  optionPressed: {opacity: 0.7},
  optionText: {color: colors.textSecondary, fontSize: 13, lineHeight: 18},
  optionTextActive: {color: colors.accent, fontSize: 13, lineHeight: 18},

  /* table */
  table: {
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableRow: {flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md},
  headerRow: {backgroundColor: colors.surfaceSelected, paddingVertical: spacing.sm},
  bodyRow: {
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingVertical: spacing.sm,
  },
  cell: {alignItems: 'flex-start', flex: 1, justifyContent: 'center', minWidth: 0},
  cellRight: {alignItems: 'flex-end'},
  headerText: {fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase'},
  tableEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  tableEmptyText: {textAlign: 'center'},

  /* cell content */
  stackTight: {gap: 2},
  nameText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  tableText: {color: colors.textPrimary, fontSize: 13, lineHeight: 18},
  tabular: {fontSize: 13, fontVariant: ['tabular-nums'], lineHeight: 18},
  captionText: {fontSize: 12, lineHeight: 16},
  failuresWarn: {color: colors.warning},
  failuresMuted: {color: colors.textSecondary},

  /* section error boundary */
  sectionError: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  sectionErrorTitle: {color: colors.textSecondary, fontSize: 13, lineHeight: 18},
  sectionErrorSubtitle: {fontSize: 12, lineHeight: 16},
  sectionRetry: {
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  sectionRetryPressed: {opacity: 0.7},
  sectionRetryText: {color: colors.textPrimary, fontSize: 13, lineHeight: 18},
});
