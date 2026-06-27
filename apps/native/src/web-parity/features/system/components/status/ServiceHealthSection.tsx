/**
 * ServiceHealthSection — native parity port of
 * web/src/features/system/components/status/ServiceHealthSection.tsx.
 *
 * The Fleet-Telemetry "Service Health" accordion on the System Status page:
 * polls GET /telemetry every 2s and renders the streaming mode, connected
 * vehicle count, aggregate signal totals, and a per-vehicle streaming table
 * (VIN / status / signal count / signals-per-second / latency / last received).
 *
 * Every web behavior + state name is preserved verbatim: the
 * `useQuery({ queryKey: ['system-status','telemetry'], queryFn:
 * getTelemetryStatus, refetchInterval: 2_000 })` poll, the `data / isLoading /
 * error / refetch` destructure, `vehicles = data?.streaming_vehicles ?
 * Object.values(data.streaming_vehicles) : []`, `activeCount =
 * vehicles.filter(v => v.is_streaming).length`, the `VehicleRow` row type, the
 * six `vehicleColumns`, the `enabled`/`activeCount` header badges, and the
 * loading → Skeleton / error → QueryError / !data → EmptyState / else →
 * Grid + DataTable branch ladder.
 *
 * Native deviations from the web original (the web DOM/Tailwind stack + several
 * shared components that are not yet ported are reproduced inline with React
 * Native primitives + the already-ported native parity library):
 *   - `./AccordionSection` (the sibling collapsible panel) is not yet ported,
 *     so its behavior — a GlassPanel with a pressable header (icon, title,
 *     description, badges, rotating chevron) that toggles a bordered body — is
 *     reproduced as a local `AccordionSection` (same prop shape: icon, title,
 *     description, badges?, defaultOpen=false, children).
 *   - `@/components/layout` Grid (`grid-cols-2 md:grid-cols-4 gap-3`) becomes a
 *     local flex-wrap Grid; on a phone the cards lay out 2-up (the web `default:
 *     2` breakpoint).
 *   - `@/components/ui` Badge (a DOM <span>) becomes a local native Badge with
 *     the same variant set (info/success/warning/danger/neutral), `size`, and
 *     `dot` props; the web `bg-current` dot maps to the variant text colour.
 *   - `@/components/ui` DataTable + Column (a DOM <table> with sort/pagination)
 *     becomes a local native table — a header row + data rows in a horizontal
 *     ScrollView so every column stays usable on a phone — preserving each
 *     column's `render`, the `sortable` signal_count header (client-side
 *     sort), the `pagination` page-size paging (web default 25), `compact`
 *     row density, the `keyExtractor` (row key = VIN), the `tableId` (carried
 *     as the table testID; RN has no localStorage layout persistence) and the
 *     `emptyMessage`.
 *   - `@/components/data-display` MetricCard (label/value/icon/color) becomes a
 *     local native MetricCard; the cyan/green/purple neon colours map to the
 *     theme accent/success/violet tokens; the lucide icon renders in a tinted
 *     rounded chip.
 *   - `@/components/feedback` Skeleton (`animate-pulse h-48`) becomes a static
 *     192px rounded placeholder (the pulse loop is dropped to avoid a leaked
 *     timer under `jest --detectOpenHandles`; the block still reads as loading
 *     via accessibilityRole="progressbar").
 *   - `@/components/feedback` QueryError becomes a local native QueryError that
 *     keeps the web status-branching (404 / 401-403 / 5xx / network) +
 *     actionable copy + a Retry CTA (the ported native Button); the
 *     browser-only offline auto-retry and rate-limit "waiting" branch are
 *     dropped (no navigator.onLine / errorClassification in RN).
 *   - `@/components/feedback` EmptyState is used message-only here (the web
 *     `title` is optional and omitted), so a local message-only empty state
 *     reproduces that exact render rather than the native shared EmptyState
 *     (which requires a title).
 *   - lucide-react Satellite/Radio/Zap/TrendingUp are DOM/SVG components; they
 *     render as decorative glyph stand-ins (same convention as the
 *     AiUsageCard / helpers ports).
 *   - `@/lib/numberFormat` fmtNumber/fmtInt and `@/lib/dateFormat`
 *     formatDateTime are reproduced as native-safe shims mirroring the web
 *     defaults (en-US locale fallback, '\u2014' for nullish/invalid dates).
 *   - react-i18next useTranslation becomes a local fallback shim so every
 *     translation key + English copy is preserved verbatim.
 */

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import {isApiError} from '../../../../api/client';
import {getTelemetryStatus} from '../../../../api/devtools';
import {Button} from '../../../../components/ui/Button';
import {GlassPanel} from '../../../../components/ui/GlassPanel';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  // The web source uses single-arg `t('VIN')` calls where the key IS the
  // English copy, so the shim returns the explicit fallback when supplied and
  // otherwise echoes the key (which carries the same English text).
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ─────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function fmtInt(n: number): string {
  return fmtNumber(n, 0);
}

/* ─── native-safe date formatting (web `@/lib/dateFormat` formatDateTime) ───── */

// web `formatDateTime` -> "Apr 4, 2026, 09:30 PM"; '\u2014' for null/invalid.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleString('en-US', {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return d.toISOString();
  }
}

/* ─── lucide-react icons -> decorative glyph stand-ins ─────────────────────── */

const ICON_SATELLITE = '\u25C9'; // lucide Satellite (dish/signal)
const ICON_RADIO = '\u29BF'; // lucide Radio (broadcast)
const ICON_ZAP = '\u26A1'; // lucide Zap
const ICON_TRENDING_UP = '\u2197'; // lucide TrendingUp

/* ─── Badge (web `@/components/ui` Badge) ──────────────────────────────────── */

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeStyleSpec {
  bg: string;
  border: string;
  text: string;
}

const BADGE_VARIANTS: Record<BadgeVariant, BadgeStyleSpec> = {
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
  info: {
    bg: colors.accentSoft,
    border: colors.borderAccent,
    text: colors.accent,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textMuted,
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
};

const BADGE_FONT_SIZE: Record<BadgeSize, number> = {
  lg: 14,
  md: typography.caption,
  sm: typography.caption,
};

function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  children,
}: {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
}) {
  const spec = BADGE_VARIANTS[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: spec.bg, borderColor: spec.border},
        size === 'lg' ? styles.badgeLg : styles.badgeSm,
      ]}>
      {dot ? (
        <View style={[styles.badgeDot, {backgroundColor: spec.text}]} />
      ) : null}
      <AppText
        style={[styles.badgeLabel, {color: spec.text, fontSize: BADGE_FONT_SIZE[size]}]}
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── MetricCard (web `@/components/data-display` MetricCard) ───────────────── */

type MetricColor = 'cyan' | 'green' | 'purple';

const METRIC_COLORS: Record<MetricColor, BadgeStyleSpec> = {
  cyan: {
    bg: colors.accentSoft,
    border: colors.borderAccent,
    text: colors.accent,
  },
  green: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  purple: {
    bg: colors.violetSurface,
    border: colors.violetBorder,
    text: colors.violet,
  },
};

function MetricCard({
  label,
  value,
  iconGlyph,
  color = 'cyan',
}: {
  label: string;
  value: string | number;
  iconGlyph: string;
  color?: MetricColor;
}) {
  const c = METRIC_COLORS[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricBody}>
        <AppText numberOfLines={1} style={styles.metricLabel} tone="muted">
          {label}
        </AppText>
        <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
          {value}
        </AppText>
      </View>
      <View
        style={[
          styles.metricIcon,
          {backgroundColor: c.bg, borderColor: c.border},
        ]}>
        <AppText importantForAccessibility="no" style={[styles.metricGlyph, {color: c.text}]}>
          {iconGlyph}
        </AppText>
      </View>
    </View>
  );
}

/* ─── Grid (web `@/components/layout` Grid cols={{default:2, md:4}} gap={3}) ── */

function Grid({children}: {children: ReactNode}) {
  return <View style={styles.grid}>{children}</View>;
}

/* ─── DataTable + Column (web `@/components/ui` DataTable) ──────────────────── */

interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

const COLUMN_WIDTHS: Record<string, number> = {
  last_received: 184,
  latency_ms: 96,
  signal_count: 96,
  signals_per_second: 110,
  status: 110,
  vin: 176,
};

const DEFAULT_COLUMN_WIDTH = 120;
const PAGE_SIZE = 25; // web DataTable default page size

function columnWidth(key: string): number {
  return COLUMN_WIDTHS[key] ?? DEFAULT_COLUMN_WIDTH;
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a ?? '').localeCompare(String(b ?? ''));
}

function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  compact = false,
  pagination = false,
  emptyMessage,
}: {
  tableId: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  compact?: boolean;
  pagination?: boolean;
  emptyMessage?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sortKey) {
      return data;
    }
    const copy = [...data];
    copy.sort((a, b) => {
      const cmp = compareValues(
        (a as Record<string, unknown>)[sortKey],
        (b as Record<string, unknown>)[sortKey],
      );
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [data, sortKey, sortDir]);

  const totalPages = pagination
    ? Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
    : 1;
  const currentPage = Math.min(page, totalPages);
  const visible = pagination
    ? sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : sorted;

  const handleSort = useCallback((key: string) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
    setPage(1);
  }, []);

  const totalWidth = columns.reduce(
    (sum, col) => sum + columnWidth(col.key) + spacing.md,
    0,
  );

  return (
    <View testID={tableId}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{width: totalWidth}}>
          <View style={styles.tableHeaderRow}>
            {columns.map(col => {
              const active = sortKey === col.key;
              const cellStyle: StyleProp<ViewStyle> = [
                styles.tableHeaderCell,
                {width: columnWidth(col.key)},
                col.align === 'right' ? styles.cellRight : null,
              ];
              if (col.sortable) {
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{selected: active}}
                    key={col.key}
                    onPress={() => handleSort(col.key)}
                    style={cellStyle}>
                    <AppText style={styles.tableHeaderText} tone="muted" weight="semibold">
                      {col.header}
                      {active ? (sortDir === 'asc' ? ' \u25B4' : ' \u25BE') : ''}
                    </AppText>
                  </Pressable>
                );
              }
              return (
                <View key={col.key} style={cellStyle}>
                  <AppText style={styles.tableHeaderText} tone="muted" weight="semibold">
                    {col.header}
                  </AppText>
                </View>
              );
            })}
          </View>

          {visible.length === 0 ? (
            <View style={[styles.tableEmptyRow, {width: totalWidth}]}>
              <AppText tone="muted">{emptyMessage ?? '\u2014'}</AppText>
            </View>
          ) : (
            visible.map(row => (
              <View
                key={keyExtractor(row)}
                style={[styles.tableRow, compact ? styles.tableRowCompact : null]}>
                {columns.map(col => (
                  <View
                    key={col.key}
                    style={[
                      styles.tableCell,
                      {width: columnWidth(col.key)},
                      col.align === 'right' ? styles.cellRight : null,
                    ]}>
                    {col.render(row)}
                  </View>
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {pagination && totalPages > 1 ? (
        <View style={styles.pagination}>
          <Button
            disabled={currentPage <= 1}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            size="sm"
            variant="ghost">
            {'\u2039'}
          </Button>
          <AppText style={styles.paginationLabel} tone="muted">
            {`${currentPage} / ${totalPages}`}
          </AppText>
          <Button
            disabled={currentPage >= totalPages}
            onPress={() => setPage(p => Math.min(totalPages, p + 1))}
            size="sm"
            variant="ghost">
            {'\u203A'}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

/* ─── Skeleton (web `@/components/feedback` Skeleton className="h-48") ──────── */

function Skeleton() {
  return (
    <View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={styles.skeleton}
    />
  );
}

/* ─── QueryError (web `@/components/feedback` QueryError) ───────────────────── */

function QueryError({
  error,
  onRetry,
  t,
}: {
  error: unknown;
  onRetry?: () => void;
  t: NativeTFunction;
}) {
  const status = isApiError(error) ? error.status : undefined;

  let title: string;
  let message: string;
  if (status === 404) {
    title = t('error.notFound.title', 'Resource not found');
    message = t(
      'error.notFound.message',
      'It may have been deleted or the link is wrong.',
    );
  } else if (status === 401 || status === 403) {
    title = t('error.unauthorized.title', 'Sign in required');
    message = t(
      'error.unauthorized.message',
      'Your session has expired. Please sign in again.',
    );
  } else if (status !== undefined && status >= 500) {
    title = t('error.serverError.title', 'Server error');
    message = t(
      'error.serverError.message',
      'Something went wrong on our end. Please try again.',
    );
  } else {
    title = t('error.network.title', "Can't reach server");
    message = t(
      'error.network.message',
      'Check your internet connection and try again.',
    );
  }

  return (
    <View accessibilityRole="alert" style={styles.errorState}>
      <AppText style={styles.errorTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.errorMessage} tone="muted">
        {message}
      </AppText>
      {onRetry ? (
        <Button onPress={onRetry} size="sm" variant="ghost">
          {t('error.retry', 'Retry')}
        </Button>
      ) : null}
    </View>
  );
}

/* ─── message-only empty state (web `EmptyState` with title omitted) ────────── */

function MessageEmptyState({message}: {message: string}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── AccordionSection (web `./AccordionSection`, not yet ported) ───────────── */

interface AccordionSectionProps {
  icon: ReactNode;
  title: string;
  description: string;
  badges?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

function AccordionSection({
  icon,
  title,
  description,
  badges,
  defaultOpen = false,
  children,
}: AccordionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const handleToggle = useCallback(() => setOpen(prev => !prev), []);

  return (
    <GlassPanel style={styles.accordion}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={handleToggle}
        style={({pressed}) => [
          styles.accordionHeader,
          pressed ? styles.accordionHeaderPressed : null,
        ]}>
        <View style={styles.accordionIcon}>{icon}</View>
        <View style={styles.accordionTitleWrap}>
          <AppText numberOfLines={1} style={styles.accordionTitle} weight="semibold">
            {title}
          </AppText>
          <AppText numberOfLines={2} style={styles.accordionDescription} tone="muted">
            {description}
          </AppText>
        </View>
        {badges ? <View style={styles.accordionBadges}>{badges}</View> : null}
        <AppText style={styles.accordionChevron} tone="muted">
          {open ? '\u25B4' : '\u25BE'}
        </AppText>
      </Pressable>
      {open ? <View style={styles.accordionBody}>{children}</View> : null}
    </GlassPanel>
  );
}

/* ─── ServiceHealthSection ─────────────────────────────────────────────────── */

export function ServiceHealthSection() {
  const t = useNativeTranslationFallback();

  const {data, isLoading, error, refetch} = useQuery({
    queryKey: ['system-status', 'telemetry'],
    queryFn: getTelemetryStatus,
    refetchInterval: 2_000,
  });

  const vehicles = data?.streaming_vehicles
    ? Object.values(data.streaming_vehicles)
    : [];
  const activeCount = vehicles.filter(v => v.is_streaming).length;

  type VehicleRow = (typeof vehicles)[number];

  const vehicleColumns: Column<VehicleRow>[] = [
    {
      key: 'vin',
      header: t('VIN'),
      render: row => (
        <AppText numberOfLines={1} style={styles.monoCell}>
          {row.vin}
        </AppText>
      ),
    },
    {
      key: 'status',
      header: t('Status'),
      render: row => (
        <Badge
          dot
          size="sm"
          variant={row.is_streaming ? 'success' : 'neutral'}>
          {row.is_streaming ? t('Streaming') : t('Idle')}
        </Badge>
      ),
    },
    {
      key: 'signal_count',
      header: t('Signals'),
      sortable: true,
      align: 'right',
      render: row => (
        <AppText style={styles.numericCell}>{fmtInt(row.signal_count)}</AppText>
      ),
    },
    {
      key: 'signals_per_second',
      header: t('Signals/s'),
      align: 'right',
      render: row => (
        <AppText style={styles.numericCell}>
          {fmtNumber(row.signals_per_second, 1)}
        </AppText>
      ),
    },
    {
      key: 'latency_ms',
      header: t('Latency'),
      align: 'right',
      render: row => (
        <AppText style={styles.numericCell}>
          {`${fmtNumber(row.latency_ms, 0)} ms`}
        </AppText>
      ),
    },
    {
      key: 'last_received',
      header: t('Last Received'),
      render: row => (
        <AppText numberOfLines={1} style={styles.cellText}>
          {formatDateTime(row.last_received)}
        </AppText>
      ),
    },
  ];

  return (
    <AccordionSection
      badges={
        data ? (
          <>
            <Badge dot size="sm" variant={data.enabled ? 'success' : 'neutral'}>
              {data.enabled ? t('Enabled') : t('Disabled')}
            </Badge>
            <Badge size="sm" variant="info">
              {`${activeCount} ${t('streaming')}`}
            </Badge>
          </>
        ) : undefined
      }
      description={t('Fleet Telemetry streaming status')}
      icon={
        <AppText importantForAccessibility="no" style={styles.headerIcon}>
          {ICON_SATELLITE}
        </AppText>
      }
      title={t('Service Health')}>
      {isLoading ? (
        <Skeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => refetch()} t={t} />
      ) : !data ? (
        <MessageEmptyState message={t('No telemetry data available')} />
      ) : (
        <View style={styles.content}>
          <Grid>
            <MetricCard
              color="cyan"
              iconGlyph={ICON_RADIO}
              label={t('Mode')}
              value={data.mode}
            />
            <MetricCard
              color="green"
              iconGlyph={ICON_SATELLITE}
              label={t('Vehicles Connected')}
              value={activeCount}
            />
            <MetricCard
              color="purple"
              iconGlyph={ICON_ZAP}
              label={t('Total Signals')}
              value={fmtInt(data.aggregate_stats?.total_signals_received ?? 0)}
            />
            <MetricCard
              color="cyan"
              iconGlyph={ICON_TRENDING_UP}
              label={t('Avg Signals/s')}
              value={data.aggregate_stats?.avg_signals_per_second ?? '0'}
            />
          </Grid>
          <DataTable
            columns={vehicleColumns}
            compact
            data={vehicles}
            emptyMessage={t('No vehicles connected')}
            keyExtractor={v => v.vin}
            pagination
            tableId="system:service-vehicles"
          />
        </View>
      )}
    </AccordionSection>
  );
}

ServiceHealthSection.displayName = 'ServiceHealthSection';

/* ─── styles ───────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  accordion: {
    overflow: 'hidden',
  },
  accordionBadges: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.sm,
  },
  accordionBody: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  accordionChevron: {
    fontSize: 14,
  },
  accordionDescription: {
    fontSize: typography.caption,
    marginTop: 2,
  },
  accordionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  accordionHeaderPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  accordionIcon: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
  },
  accordionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  accordionTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  badgeDot: {
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  badgeLabel: {
    letterSpacing: 0.2,
  },
  badgeLg: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  cellText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  content: {
    gap: spacing.md,
  },
  emptyMessage: {
    fontSize: typography.body,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  errorMessage: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
  errorState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  headerIcon: {
    color: colors.accent,
    fontSize: 18,
  },
  metricBody: {
    flex: 1,
    minWidth: 0,
  },
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    justifyContent: 'space-between',
    minWidth: 150,
    padding: spacing.md,
  },
  metricGlyph: {
    fontSize: 14,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  metricLabel: {
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    marginTop: 2,
  },
  monoCell: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: typography.caption,
  },
  numericCell: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontVariant: ['tabular-nums'],
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
  },
  paginationLabel: {
    fontSize: typography.caption,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 192,
  },
  tableCell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  tableEmptyRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  tableHeaderCell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  tableHeaderText: {
    fontSize: typography.caption,
    letterSpacing: 0.3,
  },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  tableRowCompact: {
    paddingVertical: spacing.xs,
  },
});
