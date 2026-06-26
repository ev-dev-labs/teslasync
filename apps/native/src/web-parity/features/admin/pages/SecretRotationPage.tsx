// Native parity port of web/src/features/admin/pages/SecretRotationPage.tsx.
//
// The web module is the admin "Secret Rotation" observability surface: a
// PageContainer (title + subtitle + a DataFreshness chip driven by the query)
// wrapping a FadeIn column that renders, in order: a "Subsystem unavailable"
// AlertBanner when the endpoint 503s, an "Overdue rotations" danger AlertBanner
// when any secret is past its critical threshold, a four-up StatCard grid
// (Tracked secrets / OK / Warn / Critical) shown only when there is data, and a
// "Rotation status" GlassPanel whose body is either an EmptyState (no tracked
// secrets) or a DataTable of SecretRotationStatus rows (kind / last rotated /
// age days / expires / warn-critical thresholds / severity Badge), wrapped in a
// SectionErrorBoundary. It is backed by GET
// /api/v1/admin/observability/secret-rotation via useSecretRotation().
//
// Native-safe substitutions (rule 5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallbackOrOptions?, values?) returns the English fallback (or the
//     `defaultValue`) and interpolates {{token}} placeholders, so every key +
//     copy string (incl. the {{days}}/{{count}} interpolations) is preserved
//     verbatim at the call site.
//   • usePageTitle(...) -> a native no-op hook (no document.title in RN); the
//     call site and its translated title key are preserved.
//   • The shared web <PageContainer> -> an inlined native PageContainer that
//     keeps the header (title/subtitle/actions) + loading/error/empty/children
//     branch semantics (this page passes only title/subtitle/query, so children
//     always render), wrapped in a ScrollView. Its `query` prop renders an
//     inlined DataFreshness chip (DataFreshnessAuto parity): status is
//     error > fetching > stale > fresh, with the same relative-time / "updating…"
//     / "error" label logic. The web's 30s re-render interval is dropped (the
//     label is computed once at render) to avoid a dangling timer under
//     --detectOpenHandles; the icon glyphs (Wifi/RefreshCw/WifiOff) collapse to
//     a tone-coloured status dot.
//   • The lucide-react ShieldCheck / AlertTriangle glyphs -> the native
//     SemanticIcon registry (securityCheck / warning). SemanticIcon renders in
//     its own semantic tone, so the web `text-rose-300` override on the critical
//     StatCard AlertTriangle is not applied (the BackupRestorePage icon-override
//     precedent).
//   • The shared web <GlassPanel>/<Badge>/<DataTable>/<StatCard>/<PanelTitle>/
//     <Caption>/<EmptyState>/<AlertBanner>/<SectionErrorBoundary> + <FadeIn> ->
//     the ported native GlassPanel/AppText/FadeIn/AlertBanner/EmptyState plus
//     inlined native Badge/DataTable/StatCard/PanelTitle/Caption and a real
//     native error-boundary class. The DataTable adds `align: 'right'` cell
//     support to mirror the web column alignment.
//   • @/lib formatters (fmtNumber / formatDateTime / formatRelative) -> inlined
//     verbatim (en-US locale, the same "—" fallbacks). fmtNumber keeps the web
//     module's default decimal precision of 2.
//   • @/lib/resilience isApiError -> the already-ported isApiError from the
//     native api/client (same name + status contract); the 503 subsystem-missing
//     branch is preserved.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys), and the API path / query key are preserved by the ported hook.
// No DOM elements, react-i18next, lucide-react, framer-motion, Recharts, Leaflet,
// react-dom, or web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  useSecretRotation,
  type SecretRotationSeverity,
  type SecretRotationStatus,
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
// deterministic output (the BackupRestorePage en-US precedent).
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

// Web @/lib/dateFormat formatDateTime: "Apr 4, 2026, 09:05 PM" with a "—"
// fallback for missing / invalid timestamps.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
// site adds `className="mb-4"`; the bottom margin is folded into the style.
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
  icon?: ReactNode;
}

// Web StatCard: a Card with a label + optional top-right icon, then a 2xl-bold
// value. The loading/unit/trend/sublabel props the web exposes are unused by
// this page and are omitted from the native surface.
function StatCard({label, value, icon}: StatCardProps): React.ReactElement {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardHeader}>
        <AppText numberOfLines={1} style={styles.statCardLabel} tone="muted">
          {label}
        </AppText>
        {icon ? <View>{icon}</View> : null}
      </View>
      <AppText numberOfLines={1} style={styles.statCardValue}>
        {value}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge                                      */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_TONES: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
};

function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}): React.ReactElement {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[styles.badge, {backgroundColor: tone.bg, borderColor: tone.border}]}>
      <AppText style={[styles.badgeText, {color: tone.text}]} weight="semibold">
        {children}
      </AppText>
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
/*  Severity maps (verbatim from the source)                          */
/* ------------------------------------------------------------------ */

const SEVERITY_VARIANT: Record<SecretRotationSeverity, BadgeVariant> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

const SEVERITY_LABEL: Record<SecretRotationSeverity, string> = {
  ok: 'OK',
  warn: 'Rotate soon',
  critical: 'Overdue',
  unknown: '—',
};

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function SecretRotationPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('admin.secretRotation.pageTitle', 'Secret Rotation'));

  const query = useSecretRotation();
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  // Web reads `query.data?.items ?? []` inline; memoise here so the array
  // reference is stable for the `counts` useMemo dependency (native
  // react-hooks/exhaustive-deps is stricter than the web lint config).
  const items = useMemo<SecretRotationStatus[]>(
    () => query.data?.items ?? [],
    [query.data],
  );

  const counts = useMemo(() => {
    let ok = 0;
    let warn = 0;
    let critical = 0;
    for (const it of items) {
      if (it.severity === 'ok') {
        ok += 1;
      } else if (it.severity === 'warn') {
        warn += 1;
      } else if (it.severity === 'critical') {
        critical += 1;
      }
    }
    return {ok, warn, critical, total: items.length};
  }, [items]);

  const columns = useMemo<Column<SecretRotationStatus>[]>(
    () => [
      {
        key: 'kind',
        header: t('admin.secretRotation.colKind', 'Kind'),
        render: r => (
          <View style={styles.stackTight}>
            <AppText style={styles.nameText}>{formatKind(r.kind)}</AppText>
            {r.target_id ? <Caption>{r.target_id}</Caption> : null}
          </View>
        ),
      },
      {
        key: 'rotated',
        header: t('admin.secretRotation.colRotated', 'Last rotated'),
        render: r => (
          <View style={styles.stackTight}>
            <AppText style={styles.tableText}>
              {formatDateTime(r.last_rotated)}
            </AppText>
            <Caption>{formatRelative(r.last_rotated)}</Caption>
          </View>
        ),
      },
      {
        key: 'age',
        header: t('admin.secretRotation.colAge', 'Age (days)'),
        align: 'right',
        render: r => <AppText style={styles.tabular}>{fmtNumber(r.age_days)}</AppText>,
      },
      {
        key: 'expiry',
        header: t('admin.secretRotation.colExpiry', 'Expires'),
        render: r => {
          if (!r.expires_at) {
            return (
              <AppText style={styles.tableText} tone="secondary">
                —
              </AppText>
            );
          }
          return (
            <View style={styles.stackTight}>
              <AppText style={styles.tableText}>
                {formatDateTime(r.expires_at)}
              </AppText>
              <Caption>
                {r.days_to_expiry !== null && r.days_to_expiry !== undefined
                  ? t(
                      'admin.secretRotation.daysToExpiry',
                      '{{days}}d remaining',
                      {days: r.days_to_expiry},
                    )
                  : ''}
              </Caption>
            </View>
          );
        },
      },
      {
        key: 'thresholds',
        header: t('admin.secretRotation.colThresholds', 'Warn / critical'),
        align: 'right',
        render: r => (
          <AppText style={styles.tabular}>
            {fmtNumber(r.warn_days)}d / {fmtNumber(r.critical_days)}d
          </AppText>
        ),
      },
      {
        key: 'severity',
        header: t('admin.secretRotation.colSeverity', 'Severity'),
        align: 'right',
        render: r => (
          <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'}>
            {SEVERITY_LABEL[r.severity] ?? r.severity}
          </Badge>
        ),
      },
    ],
    [t],
  );

  return (
    <PageContainer
      title={t('admin.secretRotation.pageTitle', 'Secret Rotation')}
      subtitle={t(
        'admin.secretRotation.subtitle',
        'Status of every tracked credential. Severity reflects per-kind warn/critical thresholds; rotate anything in the critical tier as soon as possible.',
      )}
      query={query}>
      <FadeIn>
        <View style={styles.contentStack}>
          {subsystemMissing ? (
            <AlertBanner
              title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}
              variant="warning">
              {t(
                'admin.secretRotation.notConfigured',
                'The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page.',
              )}
            </AlertBanner>
          ) : null}

          {counts.critical > 0 ? (
            <AlertBanner
              title={t('admin.secretRotation.criticalTitle', 'Overdue rotations')}
              variant="danger">
              {t(
                'admin.secretRotation.criticalMessage',
                '{{count}} secrets are past their critical rotation threshold. These should be rotated immediately to reduce blast radius.',
                {count: counts.critical},
              )}
            </AlertBanner>
          ) : null}

          {items.length > 0 ? (
            <View style={styles.statsGrid}>
              <View style={styles.statCell}>
                <StatCard
                  icon={<SemanticIcon decorative name="securityCheck" size="sm" />}
                  label={t('admin.secretRotation.totalLabel', 'Tracked secrets')}
                  value={fmtNumber(counts.total)}
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  label={t('admin.secretRotation.okLabel', 'OK')}
                  value={fmtNumber(counts.ok)}
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  label={t('admin.secretRotation.warnLabel', 'Warn')}
                  value={fmtNumber(counts.warn)}
                />
              </View>
              <View style={styles.statCell}>
                <StatCard
                  icon={
                    counts.critical > 0 ? (
                      <SemanticIcon decorative name="warning" size="sm" />
                    ) : null
                  }
                  label={t('admin.secretRotation.criticalLabel', 'Critical')}
                  value={fmtNumber(counts.critical)}
                />
              </View>
            </View>
          ) : null}

          <GlassPanel style={styles.panel}>
            <PanelTitle>
              {t('admin.secretRotation.tableTitle', 'Rotation status')}
            </PanelTitle>
            <SectionErrorBoundary name="secret-rotation-table">
              {items.length === 0 && !query.isLoading && !subsystemMissing ? (
                // no-action: rotation events are recorded automatically by the
                // rotation tracker; no user action seeds them.
                <EmptyState
                  icon={<SemanticIcon decorative name="securityCheck" size="lg" />}
                  message={t(
                    'admin.secretRotation.emptyMessage',
                    'No rotation events have been recorded yet. The tracker captures observations on every credential rotation.',
                  )}
                  title={t('admin.secretRotation.emptyTitle', 'No tracked secrets')}
                />
              ) : (
                <DataTable
                  columns={columns}
                  data={items}
                  emptyMessage={t(
                    'admin.secretRotation.emptyTable',
                    'No tracked secrets',
                  )}
                  keyExtractor={r => `${r.kind}:${r.target_id ?? ''}`}
                  tableId="admin:secret-rotation"
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </View>
      </FadeIn>
    </PageContainer>
  );
}

// Map raw kind enum to a friendly label. Falls back to the raw value so
// newly-added kinds still render before this map is updated.
const KIND_LABELS: Record<string, string> = {
  tesla_refresh_token: 'Tesla refresh token',
  mqtt_mtls_cert: 'MQTT mTLS certificate',
  database_password: 'Database password',
  session_jwk: 'Session JWK',
  app_signing_key: 'App signing key',
  authentik_secret: 'Authentik client secret',
};

function formatKind(raw: string): string {
  return KIND_LABELS[raw] ?? raw;
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
  statCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  statCardLabel: {flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18},
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },

  /* panel */
  panel: {padding: spacing.lg},
  panelTitleText: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 16,
  },

  /* badge */
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {fontSize: 12, lineHeight: 16},

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
  tableText: {fontSize: 13, lineHeight: 18},
  tabular: {fontSize: 13, fontVariant: ['tabular-nums'], lineHeight: 18},
  captionText: {fontSize: 12, lineHeight: 16},

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
