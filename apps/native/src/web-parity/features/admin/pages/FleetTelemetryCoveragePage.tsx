// Native parity port of web/src/features/admin/pages/FleetTelemetryCoveragePage.tsx.
//
// Operator-facing view of the package-derived Fleet Telemetry routing snapshot
// (GET /api/v1/tesla/fleet-telemetry/coverage). Every behaviour from the web
// page is preserved one-for-one:
//   - The `summarise()` reducer (totalCategories / totalRoutedFields /
//     subscribedFields / unsubscribedRoutedFields / orphanFields) with the same
//     null-guarding (`categories ?? []`, `fields ?? []`, `orphan_fields ?? []`).
//   - `buildFieldColumns(t)` returning the five field columns (field,
//     destination, column, also_signal_log/Dual write, subscribed) with the same
//     dash placeholders and Badge variants.
//   - The `CategorySection` sub-component: per-category filter useMemo over
//     field/destination/column (lower-cased, trimmed), the destination chips
//     sorted desc by count, and the per-category DataTable.
//   - The page-level `filter` state, the `stats` / `destinationTotals` /
//     `sortedDestinations` / `orphans` / `categories` / `filteredCategories`
//     memos, and the five render branches (loading / error / empty / filter-
//     empty / categories).
//   - The optional `testHookOverride` prop so tests can inject a query result.
//   - Every i18n key keeps its English default string (intent preserved), and
//     the one interpolated string (coverage.category.totalFields {{count}}) is
//     reproduced by the native t() shim.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback, options?) => fallback shim that applies i18next `{{name}}`
//     interpolation against the English fallback copy.
//   - lucide-react AlertTriangle / RefreshCw -> shared SemanticIcon glyphs
//     'warning' / 'refresh'.
//   - @/components/layout PageContainer -> inline native PageContainer
//     (ScrollView page rendering title + subtitle + an actions slot, children
//     wrapped in a SectionErrorBoundary). This page passes only title/subtitle/
//     actions, so the web loading/error/empty PageContainer branches (unused
//     here — the page renders those states inline) are intentionally omitted.
//   - @/components/ui GlassPanel -> the existing native GlassPanel.
//   - @/components/ui Badge/Button/Input/DataTable + type Column -> inline native
//     equivalents (label/icon Badge, label/icon/loading Button, TextInput-backed
//     Input, and a horizontally scrolling DataTable). The web DataTable's column
//     sort is controlled — this page wires no onSort, so header taps are a no-op
//     there too; the native table therefore renders rows in source order and the
//     `sortable` flag is preserved on the Column type for shape parity.
//   - @/components/ui/Typography Heading/Text/Caption -> AppText-based helpers
//     (panelTitle = 16px semibold primary; bodySm = 12px secondary; caption =
//     12px muted), matching the web typography roles.
//   - @/components/data-display StatCard -> the already-ported native StatCard.
//   - @/components/feedback Spinner/EmptyState -> inline native Spinner
//     (ActivityIndicator) and EmptyState (optional icon + title + message).
//   - @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade.
//   - @/hooks/usePageTitle -> native-safe usePageTitle(): feature-detects
//     document.title (present on react-native-web, absent on bare native) and
//     writes "{title} — TeslaSync", mirroring the web titleStore format.
//   - @/lib/numberFormat fmtInt -> inlined safeNumber + fmtInt (locale en-US,
//     0 decimals) matching the web default global locale/precision.
//
// CSS vars / Tailwind map to tokens: --text-primary/secondary/muted ->
// textPrimary/textSecondary/textMuted; amber-* (orphan panel) -> warning tokens;
// rose-* (error panel) -> danger tokens; font-mono -> a Platform-selected
// monospace family. No DOM-only modules, HTML elements, Recharts, Leaflet, or
// web UI components are imported — only react, react-native primitives, the
// ported web-parity hook + types, and existing apps/native SemanticIcon /
// AppText / GlassPanel / StatCard / theme tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

import {StatCard} from '../../../components/data-display';
import {useFleetTelemetryCoverage} from '../../../api/hooks/useFleetTelemetry';
import type {
  FleetTelemetryCategoryCoverage,
  FleetTelemetryFieldCoverage,
  FleetTelemetryCoverageResponse,
} from '../../../api/types';

/* ─── shared types ────────────────────────────────────────────────────── */

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
type BadgeSize = 'sm' | 'md' | 'lg';
type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md';

type RowKey = string | number;

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: number;
}

export interface FleetTelemetryCoveragePageProps {
  /** Override the live hook for Storybook / tests. */
  testHookOverride?: ReturnType<typeof useFleetTelemetryCoverage>;
}

interface SummaryStats {
  totalCategories: number;
  totalRoutedFields: number;
  subscribedFields: number;
  unsubscribedRoutedFields: number;
  orphanFields: number;
}

const DEFAULT_COL_WIDTH = 140;

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

/* ─── i18n shim ───────────────────────────────────────────────────────── */

// react-i18next useTranslation replacement: returns the English fallback the
// source passes as the second argument, with i18next `{{name}}` interpolation
// applied against that fallback when an options bag is supplied.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

/* ─── usePageTitle shim ───────────────────────────────────────────────── */

// Native-safe port of @/hooks/usePageTitle. document.title exists on
// react-native-web but not on bare native, so the write is feature-detected.
// Mirrors the web titleStore "{title} — TeslaSync" format and restores the
// previous title on unmount.
function usePageTitle(title: string): void {
  useEffect(() => {
    const doc = (globalThis as {document?: {title?: string}}).document;
    if (doc && typeof doc.title === 'string') {
      const prev = doc.title;
      doc.title = `${title} — TeslaSync`;
      return () => {
        doc.title = prev;
      };
    }
    return undefined;
  }, [title]);
}

/* ─── number formatting (ported from @/lib/numberFormat) ──────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// fmtInt(v) === fmtNumber(v, 0): locale-aware integer with the web default
// global locale ('en-US') and precision 0, falling back to a rounded string if
// Intl is unavailable on the host runtime.
function fmtInt(v: unknown): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(n));
  }
}

/* ─── typography helpers (Typography Heading / Text / Caption) ────────── */

// Heading level="panel" -> panelTitle role (text-base semibold text-primary).
function Heading({children, style}: {children: ReactNode; style?: TextStyle}) {
  return (
    <AppText style={[styles.panelTitle, style]} weight="semibold">
      {children}
    </AppText>
  );
}

// Text variant="bodySm" -> bodySm role (text-xs text-secondary). Tone/weight/
// style overrides reproduce the web className colour/emphasis tweaks.
function Text({
  children,
  tone = 'secondary',
  weight,
  style,
  testID,
}: {
  children: ReactNode;
  tone?: 'primary' | 'secondary' | 'muted' | 'danger';
  weight?: 'regular' | 'semibold' | 'bold';
  style?: TextStyle;
  testID?: string;
}) {
  return (
    <AppText style={style} testID={testID} tone={tone} variant="caption" weight={weight}>
      {children}
    </AppText>
  );
}

// Caption -> caption role (text-xs text-muted).
function Caption({children, style}: {children: ReactNode; style?: TextStyle}) {
  return (
    <AppText style={style} tone="muted" variant="caption">
      {children}
    </AppText>
  );
}

/* ─── Badge (web @/components/ui Badge) ───────────────────────────────── */

function Badge({
  label,
  variant = 'neutral',
  size = 'md',
  icon,
}: {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: SemanticIconName;
}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant], badgeSizeStyles[size]]}>
      {icon ? (
        <SemanticIcon decorative name={icon} size="sm" style={styles.badgeIcon} />
      ) : null}
      <AppText
        style={[badgeTextStyles[variant], size === 'lg' ? styles.badgeTextLg : styles.badgeTextSm]}
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ─── Button (web @/components/ui Button) ─────────────────────────────── */

function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: SemanticIconName;
  testID?: string;
}) {
  // The web Button forces disabled while loading (`disabled || loading`).
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : styles.buttonMd,
        buttonSurfaceStyles[variant],
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.textSecondary} size="small" style={styles.buttonIcon} />
      ) : icon ? (
        <SemanticIcon decorative name={icon} size="sm" style={styles.buttonIcon} />
      ) : null}
      <AppText style={buttonTextStyles[variant]} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── Input (web @/components/ui Input) ───────────────────────────────── */

// onChangeText preserves the web onChange(e => e.target.value) contract.
function Input({
  value,
  onChangeText,
  placeholder,
  label,
  testID,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  label?: string;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      {label ? (
        <AppText style={styles.fieldLabel} tone="secondary" variant="caption" weight="semibold">
          {label}
        </AppText>
      ) : null}
      <TextInput
        accessibilityLabel={label ?? placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        testID={testID}
        value={value}
      />
    </View>
  );
}

/* ─── Spinner (web @/components/feedback Spinner) ─────────────────────── */

function Spinner({size = 'md'}: {size?: 'sm' | 'md' | 'lg'}) {
  return (
    <ActivityIndicator
      accessibilityLabel="Loading"
      color={colors.accent}
      size={size === 'sm' ? 'small' : 'large'}
    />
  );
}

/* ─── FadeIn (web @/components/motion FadeIn) ─────────────────────────── */

function FadeIn({children}: {children: ReactNode}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

/* ─── EmptyState (web @/components/feedback EmptyState) ───────────────── */

function EmptyState({
  icon,
  title,
  message,
  testID,
}: {
  icon?: SemanticIconName;
  title?: string;
  message: string;
  testID?: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState} testID={testID}>
      {icon ? (
        <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIcon} />
      ) : null}
      {title ? (
        <AppText style={styles.emptyTitle} weight="bold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="secondary" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ─── SectionErrorBoundary (web PageErrorBoundary) ───────────────────── */

class SectionErrorBoundary extends React.Component<
  {fallback?: string; children: ReactNode},
  {hasError: boolean}
> {
  state = {hasError: false};

  static getDerivedStateFromError(): {hasError: boolean} {
    return {hasError: true};
  }

  componentDidCatch(): void {
    // Render-time crashes are contained to the wrapped section; the fallback
    // message replaces the subtree, mirroring the web PageErrorBoundary.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <AppText style={styles.boundaryFallback} tone="danger" variant="caption">
          {this.props.fallback ?? 'Something went wrong.'}
        </AppText>
      );
    }
    return this.props.children;
  }
}

/* ─── PageContainer (web @/components/layout PageContainer) ───────────── */

function PageContainer({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      <SectionErrorBoundary fallback={`Failed to render ${title}.`}>{children}</SectionErrorBoundary>
    </ScrollView>
  );
}

/* ─── DataTable (web @/components/ui DataTable, used subset) ──────────── */

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  testID,
}: {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => RowKey;
  emptyMessage?: string;
  testID?: string;
}) {
  const t = useNativeTranslation();
  const totalWidth = columns.reduce((sum, col) => sum + (col.width ?? DEFAULT_COL_WIDTH), 0);

  return (
    <View style={styles.table} testID={testID}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{width: totalWidth}}>
          <View style={styles.tableHeaderRow}>
            {columns.map(col => (
              <View
                key={col.key}
                style={[
                  styles.headerCell,
                  {width: col.width ?? DEFAULT_COL_WIDTH},
                  cellAlignStyles(col.align),
                ]}>
                <AppText tone="muted" variant="caption" weight="semibold">
                  {col.header}
                </AppText>
              </View>
            ))}
          </View>

          {data.length === 0 ? (
            <View style={styles.tableEmptyRow}>
              <AppText tone="muted" variant="caption">
                {emptyMessage ?? t('common.noEntries', 'No data')}
              </AppText>
            </View>
          ) : (
            data.map(row => (
              <View key={String(keyExtractor(row))} style={styles.tableBodyRow}>
                {columns.map(col => (
                  <View
                    key={col.key}
                    style={[
                      styles.bodyCell,
                      {width: col.width ?? DEFAULT_COL_WIDTH},
                      cellAlignStyles(col.align),
                    ]}>
                    {col.render(row)}
                  </View>
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/* ─── data reducers (ported verbatim from the web page) ──────────────── */

function summarise(data: FleetTelemetryCoverageResponse | undefined): SummaryStats {
  if (!data) {
    return {
      totalCategories: 0,
      totalRoutedFields: 0,
      subscribedFields: 0,
      unsubscribedRoutedFields: 0,
      orphanFields: 0,
    };
  }
  const categories = data.categories ?? [];
  let totalRoutedFields = 0;
  let subscribedFields = 0;
  for (const cat of categories) {
    const fields = cat.fields ?? [];
    totalRoutedFields += fields.length;
    for (const f of fields) {
      if (f.subscribed) subscribedFields += 1;
    }
  }
  return {
    totalCategories: categories.length,
    totalRoutedFields,
    subscribedFields,
    unsubscribedRoutedFields: totalRoutedFields - subscribedFields,
    orphanFields: (data.orphan_fields ?? []).length,
  };
}

function buildFieldColumns(t: NativeTFunction): Column<FleetTelemetryFieldCoverage>[] {
  return [
    {
      key: 'field',
      header: t('coverage.col.field', 'Field'),
      sortable: true,
      width: 200,
      render: row => (
        <AppText style={styles.monoPrimary} variant="caption">
          {row.field}
        </AppText>
      ),
    },
    {
      key: 'destination',
      header: t('coverage.col.destination', 'Destination'),
      sortable: true,
      width: 150,
      render: row => <Badge label={row.destination} size="sm" variant="info" />,
    },
    {
      key: 'column',
      header: t('coverage.col.column', 'Column'),
      sortable: true,
      width: 170,
      render: row =>
        row.column ? (
          <AppText style={styles.monoSecondary} variant="caption">
            {row.column}
          </AppText>
        ) : (
          <AppText style={styles.cellMuted} variant="caption">
            —
          </AppText>
        ),
    },
    {
      key: 'also_signal_log',
      header: t('coverage.col.dualWrite', 'Dual write'),
      width: 130,
      render: row =>
        row.also_signal_log ? (
          <Badge label={t('coverage.dualWrite.yes', 'signal_log')} size="sm" variant="warning" />
        ) : (
          <AppText style={styles.cellMuted} variant="caption">
            —
          </AppText>
        ),
    },
    {
      key: 'subscribed',
      header: t('coverage.col.subscribed', 'Subscribed'),
      sortable: true,
      width: 120,
      render: row =>
        row.subscribed ? (
          <Badge label={t('coverage.subscribed.yes', 'yes')} size="sm" variant="success" />
        ) : (
          <Badge label={t('coverage.subscribed.no', 'no')} size="sm" variant="neutral" />
        ),
    },
  ];
}

/* ─── CategorySection (ported from the web page) ─────────────────────── */

function CategorySection({
  category,
  filter,
}: {
  category: FleetTelemetryCategoryCoverage;
  filter: string;
}) {
  const t = useNativeTranslation();
  const fields = useMemo(() => category.fields ?? [], [category.fields]);
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return fields;
    return fields.filter(
      f =>
        f.field.toLowerCase().includes(q) ||
        f.destination.toLowerCase().includes(q) ||
        (f.column ?? '').toLowerCase().includes(q),
    );
  }, [fields, filter]);
  const columns = useMemo(() => buildFieldColumns(t), [t]);
  const destinations = category.destinations ?? {};
  const destEntries = Object.entries(destinations).sort((a, b) => b[1] - a[1]);

  return (
    <GlassPanel style={styles.panel} testID={`coverage-category-${category.category}`}>
      <View style={styles.categoryHeader}>
        <View style={styles.categoryHeaderText}>
          <Heading>{category.category}</Heading>
          <Caption>
            {t('coverage.category.totalFields', '{{count}} routed fields', {
              count: category.total_fields,
            })}
          </Caption>
        </View>
        <View style={styles.chipWrap}>
          {destEntries.map(([dest, count]) => (
            <Badge
              key={dest}
              label={`${dest}: ${fmtInt(count)}`}
              size="sm"
              variant="neutral"
            />
          ))}
        </View>
      </View>
      {filtered.length === 0 ? (
        <Text style={styles.italicMuted} tone="muted">
          {t('coverage.category.noMatch', 'No fields match the current filter.')}
        </Text>
      ) : (
        <DataTable<FleetTelemetryFieldCoverage>
          columns={columns}
          data={filtered}
          emptyMessage={t('coverage.category.empty', 'This category has no routed fields.')}
          keyExtractor={row => `${category.category}:${row.field}`}
          tableId={`coverage:fields:${category.category}`}
          testID={`coverage-fields-${category.category}`}
        />
      )}
    </GlassPanel>
  );
}

/* ─── page ────────────────────────────────────────────────────────────── */

export default function FleetTelemetryCoveragePage({
  testHookOverride,
}: FleetTelemetryCoveragePageProps = {}) {
  const t = useNativeTranslation();
  usePageTitle(t('coverage.pageTitle', 'Fleet Telemetry Coverage'));

  const liveQuery = useFleetTelemetryCoverage();
  const query = testHookOverride ?? liveQuery;
  const {data, isLoading, isFetching, error, refetch} = query;

  const [filter, setFilter] = useState('');

  const stats = useMemo(() => summarise(data), [data]);
  const destinationTotals = useMemo(() => data?.destination_totals ?? {}, [data]);
  const sortedDestinations = useMemo(
    () => Object.entries(destinationTotals).sort((a, b) => b[1] - a[1]),
    [destinationTotals],
  );
  const orphans = data?.orphan_fields ?? [];
  const categories = useMemo(() => data?.categories ?? [], [data]);

  const filteredCategories = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(cat => {
      if (cat.category.toLowerCase().includes(q)) return true;
      return (cat.fields ?? []).some(
        f =>
          f.field.toLowerCase().includes(q) ||
          f.destination.toLowerCase().includes(q) ||
          (f.column ?? '').toLowerCase().includes(q),
      );
    });
  }, [categories, filter]);

  return (
    <PageContainer
      actions={
        <Button
          disabled={isFetching}
          icon="refresh"
          label={t('coverage.refresh', 'Refresh')}
          loading={isFetching && !isLoading}
          onPress={() => {
            void refetch();
          }}
          testID="coverage-refresh-button"
          variant="ghost"
        />
      }
      subtitle={t(
        'coverage.subtitle',
        'Package-derived snapshot of which Tesla proto fields the build routes and which the current subscription pushes. Sourced from routing.yaml and teslaconfig.Builder — no per-vehicle telemetry counts.',
      )}
      title={t('coverage.pageTitle', 'Fleet Telemetry Coverage')}>
      <FadeIn>
        <View style={styles.statGrid}>
          <View style={styles.statItem} testID="coverage-stat-categories">
            <StatCard
              label={t('coverage.stat.categories', 'Categories')}
              value={fmtInt(stats.totalCategories)}
            />
          </View>
          <View style={styles.statItem} testID="coverage-stat-routed">
            <StatCard
              label={t('coverage.stat.routedFields', 'Routed fields')}
              value={fmtInt(stats.totalRoutedFields)}
            />
          </View>
          <View style={styles.statItem} testID="coverage-stat-subscribed">
            <StatCard
              label={t('coverage.stat.subscribed', 'Subscribed')}
              value={fmtInt(stats.subscribedFields)}
            />
          </View>
          <View style={styles.statItem} testID="coverage-stat-unsubscribed">
            <StatCard
              label={t('coverage.stat.routedNotSubscribed', 'Routed, not subscribed')}
              value={fmtInt(stats.unsubscribedRoutedFields)}
            />
          </View>
          <View style={styles.statItem} testID="coverage-stat-orphans">
            <StatCard
              label={t('coverage.stat.orphans', 'Orphan fields')}
              value={fmtInt(stats.orphanFields)}
            />
          </View>
        </View>
      </FadeIn>

      <FadeIn>
        <GlassPanel style={styles.panel} testID="coverage-legend-panel">
          <Heading>{t('coverage.legend.title', 'Reading this page')}</Heading>
          <Caption style={styles.legendIntro}>
            {t(
              'coverage.legend.intro',
              'Each row is one Tesla telemetry field declared in routing.yaml. The dashes below mean "not applicable" for that field — they are expected, not missing data.',
            )}
          </Caption>
          <View style={styles.legendList}>
            <View testID="coverage-legend-column">
              <AppText tone="secondary" variant="caption">
                <AppText style={styles.textPrimary} variant="caption" weight="semibold">
                  {t('coverage.legend.columnLabel', 'Column')}
                </AppText>
                {' '}
                {t(
                  'coverage.legend.columnHelp',
                  '— the typed destination column. A dash means the field is stored in signal_log, a generic key/value table where the field name itself is the key — there is no per-field column.',
                )}
              </AppText>
            </View>
            <View testID="coverage-legend-dual-write">
              <AppText tone="secondary" variant="caption">
                <AppText style={styles.textPrimary} variant="caption" weight="semibold">
                  {t('coverage.legend.dualWriteLabel', 'Dual write')}
                </AppText>
                {' '}
                {t(
                  'coverage.legend.dualWriteHelp',
                  '— marks fields written to both their primary table AND signal_log (for replay and historical reconstruction). A dash means single-write only, which is the normal case.',
                )}
              </AppText>
            </View>
            <View testID="coverage-legend-subscribed">
              <AppText tone="secondary" variant="caption">
                <AppText style={styles.textPrimary} variant="caption" weight="semibold">
                  {t('coverage.legend.subscribedLabel', 'Subscribed')}
                </AppText>
                {' '}
                {t(
                  'coverage.legend.subscribedHelp',
                  '— whether Tesla Fleet Telemetry is currently pushing this field to us. "No" means the writer is wired but the subscription request omits the field.',
                )}
              </AppText>
            </View>
          </View>
        </GlassPanel>
      </FadeIn>

      <FadeIn>
        <GlassPanel style={styles.panel} testID="coverage-destinations-panel">
          <Heading>{t('coverage.destinations.title', 'Destination breakdown')}</Heading>
          <Caption style={styles.legendIntro}>
            {t(
              'coverage.destinations.help',
              'Counts how many routed fields land in each storage destination. Fields routed with also_signal_log:true are counted under both their primary destination and signal_log, matching the runtime fan-out — totals may exceed the unique routed-fields count.',
            )}
          </Caption>
          {sortedDestinations.length === 0 ? (
            <Text style={styles.italicMuted} testID="coverage-destinations-empty" tone="muted">
              {t('coverage.destinations.empty', 'No destinations reported.')}
            </Text>
          ) : (
            <View style={styles.chipWrap} testID="coverage-destinations-list">
              {sortedDestinations.map(([dest, count]) => (
                <Badge key={dest} label={`${dest}: ${fmtInt(count)}`} size="md" variant="info" />
              ))}
            </View>
          )}
        </GlassPanel>
      </FadeIn>

      {orphans.length > 0 ? (
        <FadeIn>
          <GlassPanel style={[styles.panel, styles.orphanPanel]} testID="coverage-orphans-panel">
            <View style={styles.orphanHeader}>
              <SemanticIcon decorative name="warning" size="sm" style={styles.orphanIcon} />
              <View style={styles.orphanHeaderText}>
                <Heading style={styles.warningText}>
                  {t('coverage.orphans.title', 'Orphan fields detected')}
                </Heading>
                <Caption>
                  {t(
                    'coverage.orphans.help',
                    'These routing.yaml entries reference Field names not present in protomodel.SignalsByName and not a strict prefix-extension of a compound parent. This is a deployment drift between the vendored Tesla proto and routing.yaml — investigate before relying on the affected destinations.',
                  )}
                </Caption>
              </View>
            </View>
            <View style={styles.orphanList}>
              {orphans.map(orphan => (
                <AppText key={orphan} style={styles.orphanItem} variant="caption">
                  {`• ${orphan}`}
                </AppText>
              ))}
            </View>
          </GlassPanel>
        </FadeIn>
      ) : null}

      <FadeIn>
        <GlassPanel style={styles.panel} testID="coverage-filter-panel">
          <Input
            onChangeText={setFilter}
            placeholder={t(
              'coverage.filter.placeholder',
              'Filter by field name, destination, or column…',
            )}
            testID="coverage-filter-input"
            value={filter}
          />
        </GlassPanel>
      </FadeIn>

      {isLoading ? (
        <View style={styles.loadingRow} testID="coverage-loading">
          <Spinner size="sm" />
          <Text>{t('coverage.loading', 'Loading routing snapshot…')}</Text>
        </View>
      ) : error ? (
        <GlassPanel style={[styles.panel, styles.errorPanel]} testID="coverage-error">
          <View style={styles.errorRow}>
            <SemanticIcon decorative name="warning" size="sm" style={styles.errorIcon} />
            <Text style={styles.dangerText} tone="danger">
              {t(
                'coverage.error',
                'Could not load Fleet Telemetry coverage. Check API logs and try again.',
              )}
            </Text>
          </View>
        </GlassPanel>
      ) : categories.length === 0 ? (
        // no-action: package-derived snapshot — no user action recovers an empty routing.yaml
        <EmptyState
          message={t(
            'coverage.empty',
            'No categories returned. The embedded routing.yaml may be empty or the loader failed silently.',
          )}
          testID="coverage-empty"
        />
      ) : filteredCategories.length === 0 ? (
        // no-action: filter is right above the panel — clearing it is the only recovery
        <EmptyState
          message={t('coverage.filterEmpty', 'No categories match the current filter.')}
          testID="coverage-filter-empty"
        />
      ) : (
        <View style={styles.categoryList} testID="coverage-categories">
          {filteredCategories.map(cat => (
            <FadeIn key={cat.category}>
              <CategorySection category={cat} filter={filter} />
            </FadeIn>
          ))}
        </View>
      )}
    </PageContainer>
  );
}

/* ─── style helpers ───────────────────────────────────────────────────── */

function cellAlignStyles(align?: 'left' | 'center' | 'right'): ViewStyle {
  if (align === 'right') return styles.cellAlignRight;
  if (align === 'center') return styles.cellAlignCenter;
  return styles.cellAlignLeft;
}

/* ─── styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statItem: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
  },
  legendIntro: {
    marginBottom: spacing.xs,
  },
  legendList: {
    gap: spacing.sm,
  },
  textPrimary: {
    color: colors.textPrimary,
  },
  italicMuted: {
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  categoryHeaderText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  categoryList: {
    gap: spacing.md,
  },
  orphanPanel: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  orphanHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  orphanHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  orphanIcon: {
    marginTop: 2,
  },
  orphanList: {
    gap: spacing.xs,
    paddingLeft: spacing.sm,
  },
  orphanItem: {
    color: colors.warning,
    fontFamily: MONO_FONT,
  },
  warningText: {
    color: colors.warning,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  errorPanel: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  errorIcon: {
    marginTop: 2,
  },
  dangerText: {
    flex: 1,
    minWidth: 0,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    marginBottom: 2,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    fontSize: 14,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
  },
  badgeIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
  },
  badgeTextSm: {
    fontSize: 11,
    lineHeight: 16,
  },
  badgeTextLg: {
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
  },
  buttonSm: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  buttonMd: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.82,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  emptyMessage: {
    textAlign: 'center',
    maxWidth: 360,
  },
  boundaryFallback: {
    paddingVertical: spacing.md,
  },
  table: {
    gap: spacing.sm,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  tableBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableEmptyRow: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  headerCell: {
    paddingHorizontal: spacing.sm,
  },
  bodyCell: {
    paddingHorizontal: spacing.sm,
  },
  cellAlignLeft: {
    alignItems: 'flex-start',
  },
  cellAlignCenter: {
    alignItems: 'center',
  },
  cellAlignRight: {
    alignItems: 'flex-end',
  },
  cellMuted: {
    color: colors.textMuted,
  },
  monoPrimary: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
  },
  monoSecondary: {
    color: colors.textSecondary,
    fontFamily: MONO_FONT,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
});

const badgeSizeStyles = StyleSheet.create<Record<BadgeSize, ViewStyle>>({
  sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  md: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  lg: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {color: colors.accent},
  success: {color: colors.success},
  warning: {color: colors.warning},
  danger: {color: colors.danger},
  neutral: {color: colors.textSecondary},
});

const buttonSurfaceStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  secondary: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  ghost: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
});

const buttonTextStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  primary: {color: colors.accent},
  secondary: {color: colors.textPrimary},
  ghost: {color: colors.textSecondary},
});
