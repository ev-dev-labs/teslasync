// Native parity port of
// web/src/features/system/components/status/DataPipelineSection.tsx.
//
// The "Data Pipeline" accordion on the system-status surface: a compression-
// statistics block (4 MetricCards + a savings RadialGauge) and an export-job
// queue block (4 StatCards + a paginated job table, or an empty state). The two
// TanStack Query subscriptions, their query keys, query fns, refetch intervals,
// the four queued/processing/ready/failed counts, and the badge logic are all
// ported verbatim so the native panel surfaces exactly what the web panel does.
//
// Web -> native mapping (contract rules 4, 5 & 7); every browser-only or
// not-yet-ported dependency is replaced with a React Native-safe equivalent and
// documented in the sidecar:
//   - react-i18next `useTranslation` (web L1) -> the inlined useNativeTranslation
//     shim (the FSMHealthPanel / GeofencesPage precedent). Every web call passes
//     the English copy AS the key with no default, so the shim returns the key
//     verbatim; no interpolation is used by this file.
//   - `@tanstack/react-query` useQuery (web L2) -> used directly; react-query is
//     in the native manifest and the ServiceStatus port already drives polling
//     queries this way.
//   - lucide-react icons (web L3-6) Archive / TrendingUp / HardDrive / BarChart3
//     / Clock / Activity / CheckCircle / XCircle -> the shared native SemanticIcon
//     vocabulary for the card + header icons (archive / trendUp / hardDrive /
//     analytics / clock / activity / success / error). The status-cell icons that
//     the ported `helpers.getStatusIcon` returns become inline severity-tinted
//     glyphs (CheckCircle -> '✓', AlertTriangle -> '⚠', XCircle -> '✕').
//   - `@/components/layout` Grid cols={{default:2,md:4}} (web L7) -> a wrapping
//     native flex row (styles.metricGrid) honouring the mobile `default: 2`
//     columns (the MotorEfficiencyInsights "render the mobile default" approach).
//   - `@/components/ui` Badge / DataTable / `Column<T>` (web L8) -> an inline
//     native Badge (variant pill) + ExportJobsTable (header + rows keyed by the
//     web keyExtractor `j.id`, compact padding, default-page-size 25 pager
//     matching the web DataTable default, and the emptyMessage contract). The
//     web DataTable's interactive features (sort, resize, column menu,
//     virtualization) have no native analogue, so `Column<T>` is carried as a
//     native-pragmatic subset (key / header / render / align / sortable) and the
//     `sortable` flag on the record-count column is accepted but inert.
//   - `@/components/data-display` MetricCard / StatCard (web L9) -> the ported
//     native MetricCard / StatCard.
//   - `@/components/charts` RadialGauge (web L10) -> the ported native RadialGauge.
//   - `@/components/feedback` Skeleton / EmptyState (web L11) -> inline skeleton
//     bars (the web h-32 / h-48 placeholders) + an inline centred empty state.
//   - `@/lib/numberFormat` fmtInt / fmtPercent (web L12) -> useFormatPrefs().fmt:
//     fmtInt(v) = fmt(v, 0) and fmtPercent(v) = `${fmt(v)}%`, settings-driven and
//     locale-aware exactly like the web global-precision formatters.
//   - `@/lib/dateFormat` formatDateTime (web L13) -> the ported native DateTime
//     component ('full' variant) in the created_at cell.
//   - `@/api/devtools` getCompressionStats / getExportJobs (web L14) -> the native
//     devtools module of the same name (same /system/compression-stats and
//     /export/jobs paths).
//   - `@/api/types` `ExportJobSummary` (web L15) -> imported from the native
//     devtools module: its interface is byte-identical to api/types and shares
//     type identity with `getExportJobs`' return, avoiding any structural friction.
//   - `./AccordionSection` (web L16) -> inlined native AccordionSection: a
//     collapsible GlassPanel with a Pressable header (useState open, rotating
//     chevron) — the sibling native port does not exist yet, so it is mirrored
//     here to keep this file self-contained and typecheck-clean.
//   - `./helpers` getStatusIcon / statusTextClass / formatBytes (web L17) ->
//     inlined statusGlyph / statusColor / formatBytes ported verbatim from the
//     helpers.tsx logic (same case branches, same #4ade80/#fbbf24/#f87171/muted
//     colour map, same binary-units formatBytes).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported — only React, react-native
// primitives, react-query, and existing apps/native components (SemanticIcon,
// AppText, GlassPanel, MetricCard, StatCard, RadialGauge, DateTime), the ported
// useFormatPrefs, the native devtools data layer, and theme tokens. CSS vars map
// to tokens: --text-primary -> textPrimary, --text-muted -> textMuted.

import React, {useCallback, useState, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {
  getCompressionStats,
  getExportJobs,
  type ExportJobSummary,
} from '../../../../api/devtools';
import {RadialGauge} from '../../../../components/charts/RadialGauge';
import {MetricCard} from '../../../../components/data-display/MetricCard';
import {StatCard} from '../../../../components/data-display/StatCard';
import {DateTime} from '../../../../components/data-display/format/DateTime';
import {useFormatPrefs} from '../../../../components/data-display/format/_formatPrimitives';

// ─── i18n shim (web react-i18next useTranslation) ──────────────────────────
// Every web call passes the English copy as the key with no default, so the
// shim returns the key verbatim. Kept self-contained per the parity-tree
// precedent (no shared native i18n module exists).

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback((key, fallback) => fallback ?? key, []);
}

// ─── Bound formatters (web @/lib/numberFormat fmtInt / fmtPercent) ──────────

type BoundFmt = (value: unknown, decimals?: number) => string;

/** fmtPercent(v) = `${fmtNumber(v)}%` at the settings-derived global precision. */
function fmtPercent(value: number, fmt: BoundFmt): string {
  return `${fmt(value)}%`;
}

/** Ported verbatim from web helpers.formatBytes (binary units, 1 decimal). */
function formatBytes(bytes: number, fmt: BoundFmt): string {
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${fmt(bytes / Math.pow(k, i), 1)} ${sizes[i]}`;
}

// ─── Status icon + colour (web ./helpers getStatusIcon / statusTextClass) ───
const STATUS_GREEN = '#4ade80'; // text-green-400
const STATUS_AMBER = '#fbbf24'; // text-amber-400
const STATUS_RED = '#f87171'; // text-red-400

const CHECK_GLYPH = '\u2713'; // ✓ CheckCircle
const WARN_GLYPH = '\u26A0'; // ⚠ AlertTriangle
const CROSS_GLYPH = '\u2715'; // ✕ XCircle

function statusColor(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return STATUS_GREEN;
    case 'degraded':
    case 'warning':
    case 'pending':
    case 'queued':
    case 'processing':
      return STATUS_AMBER;
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return STATUS_RED;
    default:
      return colors.textMuted;
  }
}

function statusGlyph(status: string): string {
  switch ((status ?? '').toLowerCase()) {
    case 'healthy':
    case 'ok':
    case 'online':
    case 'connected':
    case 'ready':
    case 'sent':
    case 'completed':
      return CHECK_GLYPH;
    case 'unhealthy':
    case 'offline':
    case 'error':
    case 'down':
    case 'failed':
      return CROSS_GLYPH;
    default:
      // degraded/warning/pending/queued/processing + fallback -> AlertTriangle.
      return WARN_GLYPH;
  }
}

// ─── Badge (web @/components/ui Badge variant pill, size="sm") ──────────────
const INFO_BG = 'rgba(59, 130, 246, 0.12)'; // blue-500 @ 12%
const INFO_BORDER = 'rgba(59, 130, 246, 0.3)'; // blue-500 @ 30%
const INFO_TEXT = '#93c5fd'; // blue-300

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText
        style={[styles.badgeLabel, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ─── AccordionSection (web ./AccordionSection collapsible GlassPanel) ───────

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
        style={({pressed}) => [styles.header, pressed && styles.headerPressed]}>
        <View style={styles.headerIcon}>{icon}</View>
        <View style={styles.headerText}>
          <AppText numberOfLines={1} style={styles.headerTitle}>
            {title}
          </AppText>
          <AppText numberOfLines={2} style={styles.headerDescription} tone="muted">
            {description}
          </AppText>
        </View>
        {badges ? <View style={styles.headerBadges}>{badges}</View> : null}
        <AppText
          importantForAccessibility="no"
          style={[styles.chevron, open && styles.chevronOpen]}>
          {'\u25BE'}
        </AppText>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </GlassPanel>
  );
}

// ─── Export-job table (web @/components/ui DataTable) ───────────────────────

/**
 * Native-pragmatic subset of the web `@/components/ui` DataTable `Column<T>`.
 * Only the fields the panel uses are carried; `sortable` is accepted for source
 * parity (web record_count column) but has no native sort analogue.
 */
interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}

// Mirrors web tableId="system:pipeline-export-jobs".
const TABLE_ID = 'system:pipeline-export-jobs';
// Web DataTable default page size when `pagination` is passed as a bare boolean.
const DEFAULT_PAGE_SIZE = 25;

interface ExportJobsTableProps {
  columns: Column<ExportJobSummary>[];
  rows: ExportJobSummary[];
  emptyMessage: string;
}

function ExportJobsTable({columns, rows, emptyMessage}: ExportJobsTableProps) {
  const [page, setPage] = useState(0);

  if (rows.length === 0) {
    return (
      <View style={styles.tableEmpty}>
        <AppText style={styles.emptyText} tone="muted">
          {emptyMessage}
        </AppText>
      </View>
    );
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * DEFAULT_PAGE_SIZE;
  const visibleRows = rows.slice(start, start + DEFAULT_PAGE_SIZE);

  return (
    <View>
      <View accessibilityRole="summary" style={styles.table} testID={TABLE_ID}>
        <View style={[styles.row, styles.headerRow]}>
          {columns.map(column => (
            <View key={column.key} style={[styles.cell, alignStyle(column.align)]}>
              <AppText
                style={[styles.headerCellText, textAlignStyle(column.align)]}
                tone="muted"
                variant="caption"
                weight="semibold">
                {column.header}
              </AppText>
            </View>
          ))}
        </View>
        {visibleRows.map(row => (
          <View key={row.id} style={[styles.row, styles.bodyRow]}>
            {columns.map(column => (
              <View key={column.key} style={[styles.cell, alignStyle(column.align)]}>
                {column.render(row)}
              </View>
            ))}
          </View>
        ))}
      </View>
      {pageCount > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityLabel="Previous page"
            accessibilityRole="button"
            accessibilityState={{disabled: currentPage === 0}}
            disabled={currentPage === 0}
            hitSlop={8}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage === 0 && styles.pagerDisabled,
              pressed && currentPage !== 0 && styles.pagerPressed,
            ]}>
            <AppText style={styles.pagerGlyph} tone="muted">
              {'\u2039'}
            </AppText>
          </Pressable>
          <AppText style={styles.pagerLabel} tone="muted" variant="caption">
            {`${currentPage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityLabel="Next page"
            accessibilityRole="button"
            accessibilityState={{disabled: currentPage >= pageCount - 1}}
            disabled={currentPage >= pageCount - 1}
            hitSlop={8}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage >= pageCount - 1 && styles.pagerDisabled,
              pressed && currentPage < pageCount - 1 && styles.pagerPressed,
            ]}>
            <AppText style={styles.pagerGlyph} tone="muted">
              {'\u203A'}
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function alignStyle(align: Column<ExportJobSummary>['align']): ViewStyle {
  if (align === 'right') {
    return styles.cellRight;
  }
  if (align === 'center') {
    return styles.cellCenter;
  }
  return styles.cellLeft;
}

function textAlignStyle(align: Column<ExportJobSummary>['align']): TextStyle {
  if (align === 'right') {
    return styles.textRight;
  }
  if (align === 'center') {
    return styles.textCenter;
  }
  return styles.textLeft;
}

export function DataPipelineSection() {
  const t = useNativeTranslation();
  const {fmt} = useFormatPrefs();

  const {data: compression, isLoading: compLoading} = useQuery({
    queryKey: ['system-status', 'compression'],
    queryFn: getCompressionStats,
    refetchInterval: 30_000,
  });

  const {data: exportJobs, isLoading: exportLoading} = useQuery({
    queryKey: ['system-status', 'export-jobs'],
    queryFn: () => getExportJobs(),
    refetchInterval: 15_000,
  });

  const isLoading = compLoading || exportLoading;

  const exportColumns: Column<ExportJobSummary>[] = [
    {
      key: 'status',
      header: t('Status'),
      render: row => (
        <View style={styles.statusCell}>
          <AppText
            importantForAccessibility="no"
            style={[styles.statusGlyph, {color: statusColor(row.status)}]}>
            {statusGlyph(row.status)}
          </AppText>
          <AppText style={[styles.statusText, {color: statusColor(row.status)}]}>
            {row.status}
          </AppText>
        </View>
      ),
    },
    {
      key: 'type',
      header: t('Type'),
      render: row => <AppText style={styles.cellText}>{row.type}</AppText>,
    },
    {
      key: 'format',
      header: t('Format'),
      render: row => <Badge variant="neutral">{row.format}</Badge>,
    },
    {
      key: 'file_name',
      header: t('File'),
      render: row => (
        <AppText numberOfLines={1} style={styles.monoText}>
          {row.file_name}
        </AppText>
      ),
    },
    {
      key: 'record_count',
      header: t('Records'),
      sortable: true,
      render: row => <AppText style={styles.cellText}>{fmt(row.record_count, 0)}</AppText>,
    },
    {
      key: 'created_at',
      header: t('Created'),
      render: row => <DateTime style={styles.cellText} value={row.created_at} />,
    },
  ];

  const pendingJobs = exportJobs?.filter(j => j.status === 'queued').length ?? 0;
  const processingJobs = exportJobs?.filter(j => j.status === 'processing').length ?? 0;
  const completedJobs = exportJobs?.filter(j => j.status === 'ready').length ?? 0;
  const failedJobs = exportJobs?.filter(j => j.status === 'failed').length ?? 0;

  return (
    <AccordionSection
      badges={
        <>
          {compression ? (
            <Badge variant="info">
              {`${fmtPercent(compression.savings_percent, fmt)} ${t('saved')}`}
            </Badge>
          ) : null}
          {pendingJobs + processingJobs > 0 ? (
            <Badge variant="warning">
              {`${pendingJobs + processingJobs} ${t('active')}`}
            </Badge>
          ) : null}
        </>
      }
      description={t('Compression statistics and export job queue')}
      icon={<SemanticIcon decorative name="archive" size="sm" />}
      title={t('Data Pipeline')}>
      {isLoading ? (
        <View style={styles.loadingStack}>
          <View style={styles.skeletonSm} />
          <View style={styles.skeletonLg} />
        </View>
      ) : (
        <View style={styles.contentStack}>
          {compression ? (
            <View>
              <AppText style={styles.sectionTitle}>
                {t('Compression Statistics')}
              </AppText>
              <View style={styles.metricGrid}>
                <View style={styles.metricCell}>
                  <MetricCard
                    color="green"
                    icon={<SemanticIcon decorative name="trendUp" size="sm" />}
                    label={t('Compression Ratio')}
                    value={fmtPercent(compression.savings_percent, fmt)}
                  />
                </View>
                <View style={styles.metricCell}>
                  <MetricCard
                    color="cyan"
                    icon={<SemanticIcon decorative name="hardDrive" size="sm" />}
                    label={t('Estimated Savings')}
                    value={formatBytes(compression.estimated_saved_bytes, fmt)}
                  />
                </View>
                <View style={styles.metricCell}>
                  <MetricCard
                    color="purple"
                    icon={<SemanticIcon decorative name="analytics" size="sm" />}
                    label={t('Total Positions')}
                    value={fmt(compression.total_positions, 0)}
                  />
                </View>
                <View style={styles.metricCell}>
                  <MetricCard
                    color="cyan"
                    icon={<SemanticIcon decorative name="archive" size="sm" />}
                    label={t('Compressed')}
                    value={fmt(compression.compressed_positions, 0)}
                  />
                </View>
              </View>
              <View style={styles.gaugeRow}>
                <RadialGauge
                  color="#22c55e"
                  label={t('Savings')}
                  max={100}
                  size={140}
                  unit="%"
                  value={compression.savings_percent}
                />
              </View>
            </View>
          ) : null}

          <View>
            <AppText style={styles.sectionTitle}>{t('Export Job Queue')}</AppText>
            {exportJobs && exportJobs.length > 0 ? (
              <>
                <View style={[styles.metricGrid, styles.statGridSpacing]}>
                  <View style={styles.metricCell}>
                    <StatCard
                      icon={<SemanticIcon decorative name="clock" size="sm" />}
                      label={t('Pending')}
                      value={pendingJobs}
                    />
                  </View>
                  <View style={styles.metricCell}>
                    <StatCard
                      icon={<SemanticIcon decorative name="activity" size="sm" />}
                      label={t('Processing')}
                      value={processingJobs}
                    />
                  </View>
                  <View style={styles.metricCell}>
                    <StatCard
                      icon={<SemanticIcon decorative name="success" size="sm" />}
                      label={t('Completed')}
                      value={completedJobs}
                    />
                  </View>
                  <View style={styles.metricCell}>
                    <StatCard
                      icon={<SemanticIcon decorative name="error" size="sm" />}
                      label={t('Failed')}
                      value={failedJobs}
                    />
                  </View>
                </View>
                <ExportJobsTable
                  columns={exportColumns}
                  emptyMessage={t('No export jobs')}
                  rows={exportJobs}
                />
              </>
            ) : (
              <View style={styles.emptyState}>
                <AppText style={styles.emptyText} tone="muted">
                  {t('No export jobs in queue')}
                </AppText>
              </View>
            )}
          </View>
        </View>
      )}
    </AccordionSection>
  );
}

const styles = StyleSheet.create({
  accordion: {
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md, // gap-3
    paddingHorizontal: spacing.lg, // px-5
    paddingVertical: 16, // py-4
  },
  headerPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)', // hover:bg-white/[0.02]
  },
  headerIcon: {
    flexShrink: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
  },
  headerDescription: {
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginTop: 2, // mt-0.5
  },
  headerBadges: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.sm, // gap-2
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14, // h-4 w-4
    lineHeight: 18,
  },
  chevronOpen: {
    transform: [{rotate: '180deg'}], // rotate-180
  },
  body: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)', // border-white/[0.06]
    borderTopWidth: 1,
    paddingHorizontal: spacing.lg, // px-5
    paddingVertical: 16, // py-4
  },
  loadingStack: {
    gap: 16, // space-y-4
  },
  skeletonSm: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 128, // h-32
  },
  skeletonLg: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 192, // h-48
  },
  contentStack: {
    gap: 24, // space-y-6
  },
  sectionTitle: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
    marginBottom: spacing.md, // mb-3
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md, // gap-3 (between rows)
  },
  metricCell: {
    width: '48%', // cols default: 2
  },
  statGridSpacing: {
    marginBottom: 16, // mb-4
  },
  gaugeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16, // mt-4
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48, // py-16 (scaled for mobile)
  },
  emptyText: {
    fontSize: 14, // text-sm
    lineHeight: 20,
    maxWidth: 360, // max-w-md
    textAlign: 'center',
  },
  table: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6, // compact
  },
  headerRow: {
    backgroundColor: colors.surfaceSelected,
  },
  bodyRow: {
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  cellLeft: {
    alignItems: 'flex-start',
  },
  cellCenter: {
    alignItems: 'center',
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  cellText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  headerCellText: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  textLeft: {
    textAlign: 'left',
  },
  textCenter: {
    textAlign: 'center',
  },
  textRight: {
    textAlign: 'right',
  },
  monoText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    maxWidth: 200, // max-w-[200px]
  },
  statusCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm, // gap-2
  },
  statusGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  statusText: {
    fontSize: 12,
    lineHeight: 16,
  },
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  pagerButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  pagerGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  pagerDisabled: {
    opacity: 0.4,
  },
  pagerPressed: {
    opacity: 0.82,
  },
  pagerLabel: {
    minWidth: 36,
    textAlign: 'center',
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 6, // px-1.5
    paddingVertical: 2, // py-0.5
  },
  badgeLabel: {
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {
    backgroundColor: INFO_BG,
    borderColor: INFO_BORDER,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {
    color: INFO_TEXT,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
});

export default DataPipelineSection;
