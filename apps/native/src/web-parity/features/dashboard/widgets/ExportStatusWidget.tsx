// Native parity port of web/src/features/dashboard/widgets/ExportStatusWidget.tsx.
//
// Dashboard widget that merges two export-job queries (the hexagonal-architecture
// /export/jobs list via useExports + the same list via the admin useExportJobs),
// de-duplicates by id (admin wins for fresher status), sorts by status priority
// then recency, and renders a size-responsive view inside a widget shell:
// compact (1-col) shows a single "Active Exports" big number + Running/Idle
// badge; standard/wide show a scrollable job list (filename + format + size +
// status badge + relative time, with a 50% progress bar under processing rows
// and a download affordance on ≥3-col widgets). The web file pulls in browser-
// only or web-UI dependencies that are absent from the native parity manifest
// (contract rules 4, 5 & 7); each is replaced with a React Native-safe
// equivalent and documented here + in the sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L224) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.export*','<English>') / t('widget.noExportJobs','No export jobs')
//     call keeps its English default + translation-key intent (the established
//     AlertFeed/ChargeHistory/DashboardStats port pattern). The same
//     (key, fallback) => string `t` is threaded into CompactView/JobRow/
//     StandardView verbatim.
//   - lucide-react Download (web L3, L170, L198, L289, L302) -> the shared
//     native SemanticIcon 'download' (its download glyph). lucide SVG has no
//     native renderer; SemanticIcon tone is fixed per name, so the web title
//     icon's text-neon-cyan tint and the row download link's text-cyan-300 tint
//     collapse to the download icon's intrinsic accent tone — the same
//     color-tint -> semantic-icon collapse used by the AlertFeed
//     (neon-cyan->notifications) / ChargeHistory (neon-green->analytics) ports.
//     Title icon -> size='sm' (web h-3.5); empty + row icons -> size 'md'/'sm'.
//   - `@/components/ui` Badge (web L4, L143, L153, L55-of-WidgetBigNumber) ->
//     inlined native Badge reproducing the web variant -> color map (neutral
//     gray pill, info sky, success emerald, warning amber, danger rose) as a RN
//     View (token surface/border) + capitalized caption. No native Badge port
//     exists yet, so the variant subset this widget + WidgetBigNumber use is
//     inlined. The web `size="sm"` padding maps to the badge's fixed padding;
//     the status badge's min-w-[52px]/justify-center maps to styles.statusBadge.
//   - `@/components/data-display` MetricBar + TimeStamp (web L5, L159, L212) ->
//     the ported native MetricBar (same value/max/color/label/sublabel contract;
//     the web framer width animation is the native Animated width interpolation)
//     and the ported native TimeStamp (relative/absolute, settings-aware). The
//     web `className` on TimeStamp is a no-op on native; the 10px muted intent is
//     carried via the `style` prop.
//   - `@/components/feedback` EmptyState (web L6, L197, L301) -> inlined native
//     EmptyState: the web icon+message (no title/action) centred placeholder is
//     reproduced with RN primitives (the established ChargeHistory inline-empty
//     precedent), honouring the widget's lighter `py-4` padding. The web
//     no-action transient-empty comment is preserved.
//   - `@/api/hooks/useExports` useExports (web L7) -> the ported native
//     useExports hook (same '/export/jobs' query, ExportJob export shape with
//     fsmState/filePath/fileSize, UseQueryResult fields).
//   - `@/api/hooks/useAdmin` useExportJobs (web L8) -> the ported native
//     useExportJobs hook from useAdmin (same '/export/jobs' query, admin
//     ExportJob shape with status). Imported separately from useExports so both
//     `ExportJob` types are aliased (ExportJobExport / ExportJobAdmin) exactly
//     like the web's two `import type { ExportJob as … }` aliases.
//   - `./WidgetShell` WidgetShell (web L9) -> inlined native WidgetShell (the
//     same skeleton/error/header/overlay-freshness/pulse subset already ported
//     by the AlertFeed/ChargeHistory/DashboardStats widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./shared` WidgetBigNumber (web L10) -> inlined native WidgetBigNumber:
//     the centred big value (web AnimatedNumber -> the ported native
//     AnimatedNumber when animated, else a tabular AppText) + optional unit /
//     label / subtitle / Badge. The web `valueColor='text-white'` className
//     default collapses to the native AppText textPrimary default (this widget
//     never overrides it). Separate ./shared source, not yet ported, so inlined.
//   - `./types` WidgetProps (web L11) -> inlined native WidgetSize/WidgetProps
//     (the size subset this widget reads).
//   - `@/types/export` ExportJob as ExportJobExport (web L12) -> the native
//     useExports `ExportJob` type (id/format/vehicleId/fsmState/filePath?/
//     fileSize?/failedReason?/createdAt/completedAt?), aliased ExportJobExport.
//   - `@/types/admin` ExportJob as ExportJobAdmin (web L13) -> the native
//     useAdmin `ExportJob` type (id/type/format/status/recordCount/fileSize/
//     createdAt), aliased ExportJobAdmin.
//
// The web row download link `<a href="/api/v1/export/download/{id}">` (web
// L165-171) is a DOM anchor with no native analogue (contract rule 7). It is
// reproduced as a Pressable that hands the SAME endpoint — built absolute via
// the ported api client `apiUrl('/export/download/{id}')` (resolves to
// `{base}/api/v1/export/download/{id}`, byte-identical path to the web href) —
// to the platform URL handler through `Linking.openURL` on a best-effort basis;
// an unresolvable URL is swallowed so a failed download never crashes the row.
// The web row's `last:border-b-0` divider quirk collapses to the standard native
// `isLast` divider flag (no border on the final visible row); border-subtle ->
// the token border colour.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, the shared native SemanticIcon / AppText / theme tokens, and the
// ported parity apiUrl / useExports / useExportJobs / AnimatedNumber / MetricBar
// / TimeStamp / DataFreshness / QueryError.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {apiUrl} from '../../../api/client';
import {
  useExportJobs,
  type ExportJob as ExportJobAdmin,
} from '../../../api/hooks/useAdmin';
import {
  useExports,
  type ExportJob as ExportJobExport,
} from '../../../api/hooks/useExports';
import {AnimatedNumber} from '../../../components/data-display/AnimatedNumber';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {MetricBar} from '../../../components/data-display/MetricBar';
import {TimeStamp} from '../../../components/data-display/TimeStamp';
import {QueryError} from '../../../components/feedback/QueryError';

const MONO = Platform.select({ios: 'Courier', default: 'monospace'});

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── Normalised job shape used within this widget ─────────────────────

interface NormalisedJob {
  id: string;
  format: string;
  filePath?: string;
  fileSize: number;
  createdAt: string;
}

function fromExportHook(j: ExportJobExport): NormalisedJob {
  return {
    id: j.id,
    format: j.format,
    filePath: j.filePath,
    fileSize: j.fileSize ?? 0,
    createdAt: j.createdAt,
  };
}

function fromAdminHook(j: ExportJobAdmin): NormalisedJob {
  return {
    id: j.id,
    format: j.format,
    filePath: undefined,
    fileSize: j.fileSize ?? 0,
    createdAt: j.createdAt,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

type JobStatus = 'queued' | 'processing' | 'ready' | 'failed';

function normaliseStatusFromExport(fsmState: string | undefined): JobStatus {
  const s = (fsmState ?? '').toLowerCase();
  if (s === 'processing' || s === 'running') return 'processing';
  if (s === 'ready' || s === 'done' || s === 'completed') return 'ready';
  if (s === 'failed' || s === 'error') return 'failed';
  return 'queued';
}

function normaliseStatusFromAdmin(status: string | undefined): JobStatus {
  const s = (status ?? '').toLowerCase();
  if (s === 'processing' || s === 'running') return 'processing';
  if (s === 'ready' || s === 'done' || s === 'completed') return 'ready';
  if (s === 'failed' || s === 'error') return 'failed';
  return 'queued';
}

const STATUS_ORDER: Record<JobStatus, number> = {
  processing: 0,
  queued: 1,
  ready: 2,
  failed: 3,
};

const STATUS_BADGE: Record<
  JobStatus,
  {variant: BadgeVariant; labelKey: string; label: string}
> = {
  queued: {variant: 'neutral', labelKey: 'widget.exportQueued', label: 'Queued'},
  processing: {
    variant: 'info',
    labelKey: 'widget.exportRunning',
    label: 'Running',
  },
  ready: {variant: 'success', labelKey: 'widget.exportDone', label: 'Done'},
  failed: {variant: 'danger', labelKey: 'widget.exportFailed', label: 'Failed'},
};

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function truncateFilename(path: string | undefined, maxLen: number): string {
  if (!path) return '—';
  const name = path.split('/').pop() ?? path;
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}

// ── @/components/ui Badge (variant subset, ported inline native-safe) ──
type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const BADGE_COLORS: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  info: {
    bg: 'rgba(56, 189, 248, 0.12)',
    border: 'rgba(56, 189, 248, 0.32)',
    text: '#38bdf8',
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
  style,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const tier = BADGE_COLORS[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: tier.bg, borderColor: tier.border},
        style,
      ]}>
      <AppText
        numberOfLines={1}
        style={[styles.badgeText, {color: tier.text}]}
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ── @/components/feedback EmptyState (icon+message subset, inlined native) ──
function EmptyState({icon, message}: {icon: ReactNode; message: string}) {
  // Transient empty state — surfaces when source data is missing; no specific
  // recovery action available (matches the web EmptyState no-action comment).
  return (
    <View style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── ./shared WidgetBigNumber (ported inline native-safe) ──
const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

interface WidgetBigNumberProps {
  value: number | null;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: {
    text: string;
    variant: 'success' | 'warning' | 'error' | 'neutral';
  };
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
}

function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  badge,
  valueColor,
  nullDisplay = '—',
  animated = true,
}: WidgetBigNumberProps) {
  return (
    <View style={styles.bigNumberRoot}>
      <View style={styles.bigNumberValueRow}>
        {value !== null ? (
          animated ? (
            <AnimatedNumber
              style={[
                styles.bigNumberValue,
                valueColor ? {color: valueColor} : null,
              ]}
              value={value}
            />
          ) : (
            <AppText
              style={[
                styles.bigNumberValue,
                styles.tabularNums,
                valueColor ? {color: valueColor} : null,
              ]}>
              {value}
            </AppText>
          )
        ) : (
          <AppText style={[styles.bigNumberValue, styles.bigNumberValueNull]}>
            {nullDisplay}
          </AppText>
        )}
        {unit ? <AppText style={styles.bigNumberUnit}>{unit}</AppText> : null}
      </View>

      {label ? (
        <AppText numberOfLines={1} style={styles.bigNumberLabel}>
          {label}
        </AppText>
      ) : null}

      {subtitle ? (
        <AppText style={styles.bigNumberSubtitle}>{subtitle}</AppText>
      ) : null}

      {badge ? (
        <Badge variant={badgeVariantMap[badge.variant]}>{badge.text}</Badge>
      ) : null}
    </View>
  );
}

// ── ./WidgetShell (ported inline, native-safe subset) ──
interface WidgetShellProps {
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
}: WidgetShellProps) {
  // Pulse-on-data-change glow (web WidgetShell L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return (
      <View
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        style={styles.skeleton}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.errorWrap}>
        <QueryError error={new Error(error)} />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            {icon}
            <AppText numberOfLines={1} style={styles.title}>
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.overlayFreshness}>{freshnessEl}</View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

// ── ./types WidgetSize / WidgetProps (ported inline subset) ──
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  activeCount,
  hasRunning,
  t,
}: {
  activeCount: number;
  hasRunning: boolean;
  t: NativeTFunction;
}) {
  return (
    <WidgetBigNumber
      badge={{
        text: hasRunning
          ? t('widget.exportRunningBadge', 'Running')
          : t('widget.exportIdleBadge', 'Idle'),
        variant: hasRunning ? 'success' : 'neutral',
      }}
      label={t('widget.exportActiveJobs', 'Active Exports')}
      value={activeCount}
    />
  );
}

// ── Job row ──────────────────────────────────────────────────────────

function JobRow({
  job,
  status,
  showDownload,
  isLast,
  t,
}: {
  job: NormalisedJob;
  status: JobStatus;
  showDownload: boolean;
  isLast: boolean;
  t: NativeTFunction;
}) {
  const cfg = STATUS_BADGE[status];
  const format = (job.format ?? '').toUpperCase() || '—';

  return (
    <View style={[styles.row, isLast && styles.rowLast]}>
      {/* Filename */}
      <AppText numberOfLines={1} style={styles.filename}>
        {truncateFilename(job.filePath, 28)}
      </AppText>

      {/* Format badge */}
      <Badge variant="neutral">{format}</Badge>

      {/* File size */}
      <AppText numberOfLines={1} style={styles.fileSize}>
        {fmtBytes(job.fileSize ?? 0)}
      </AppText>

      {/* Status badge */}
      <Badge style={styles.statusBadge} variant={cfg.variant}>
        {t(cfg.labelKey, cfg.label)}
      </Badge>

      {/* Relative time */}
      <View style={styles.timeWrap}>
        <TimeStamp style={styles.timeText} value={job.createdAt} />
      </View>

      {/* Download link — wide only */}
      {showDownload ? (
        job.filePath && status === 'ready' ? (
          <Pressable
            accessibilityLabel={t('widget.exportDownload', 'Download')}
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => {
              void Linking.openURL(
                apiUrl(`/export/download/${job.id}`),
              ).catch(() => undefined);
            }}
            style={styles.downloadButton}>
            <SemanticIcon decorative name="download" size="sm" />
          </Pressable>
        ) : (
          <View style={styles.downloadSpacer} />
        )
      ) : null}
    </View>
  );
}

// ── Standard list with optional progress bars ────────────────────────

function StandardView({
  jobs,
  showDownload,
  maxItems,
  t,
}: {
  jobs: {job: NormalisedJob; status: JobStatus}[];
  showDownload: boolean;
  maxItems: number;
  t: NativeTFunction;
}) {
  const visible = jobs.slice(0, maxItems);

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<SemanticIcon decorative name="download" size="md" />}
        message={t('widget.noExportJobs', 'No export jobs')}
      />
    );
  }

  return (
    <ScrollView nestedScrollEnabled style={styles.list}>
      {visible.map(({job, status}, i) => (
        <View key={job.id}>
          <JobRow
            isLast={i === visible.length - 1}
            job={job}
            showDownload={showDownload}
            status={status}
            t={t}
          />
          {status === 'processing' ? (
            <View style={styles.progressWrap}>
              <MetricBar color="#22d3ee" label="" max={100} value={50} />
            </View>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function ExportStatusWidget({size}: WidgetProps) {
  const t = useNativeTranslation();

  const {
    data: exports,
    isLoading: exportsLoading,
    isFetching: exportsFetching,
    isStale: exportsStale,
    isError: exportsIsError,
    dataUpdatedAt: exportsUpdatedAt,
    refetch: exportsRefetch,
  } = useExports();

  const {
    data: adminJobs,
    isLoading: adminLoading,
    isFetching: adminFetching,
    isStale: adminStale,
    isError: adminIsError,
    dataUpdatedAt: adminUpdatedAt,
    refetch: adminRefetch,
  } = useExportJobs();

  const isLoading = exportsLoading || adminLoading;
  const isFetching = exportsFetching || adminFetching;
  const isStale = exportsStale || adminStale;
  const isError = exportsIsError || adminIsError;
  const updatedAt = Math.max(exportsUpdatedAt ?? 0, adminUpdatedAt ?? 0);

  // Merge and deduplicate by id, preferring adminJobs (fresher status info)
  const sortedJobs = useMemo(() => {
    const byId = new Map<string, {job: NormalisedJob; status: JobStatus}>();

    for (const j of exports ?? []) {
      byId.set(j.id, {
        job: fromExportHook(j),
        status: normaliseStatusFromExport(j.fsmState),
      });
    }
    for (const j of adminJobs ?? []) {
      byId.set(j.id, {
        job: fromAdminHook(j),
        status: normaliseStatusFromAdmin(j.status),
      });
    }

    const items = Array.from(byId.values());

    items.sort((a, b) => {
      const orderDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (orderDiff !== 0) return orderDiff;
      return (
        new Date(b.job.createdAt ?? 0).getTime() -
        new Date(a.job.createdAt ?? 0).getTime()
      );
    });

    return items;
  }, [exports, adminJobs]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const activeCount = useMemo(
    () =>
      sortedJobs.filter(
        j => j.status === 'processing' || j.status === 'queued',
      ).length,
    [sortedJobs],
  );
  const hasRunning = useMemo(
    () => sortedJobs.some(j => j.status === 'processing'),
    [sortedJobs],
  );

  return (
    <WidgetShell
      icon={<SemanticIcon decorative name="download" size="sm" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => {
        void exportsRefetch();
        void adminRefetch();
      }}
      title={t('widget.exportStatus', 'Export Status')}
      updatedAt={updatedAt}>
      {isCompact ? (
        sortedJobs.length > 0 ? (
          <CompactView activeCount={activeCount} hasRunning={hasRunning} t={t} />
        ) : (
          <EmptyState
            icon={<SemanticIcon decorative name="download" size="md" />}
            message={t('widget.noExportJobs', 'No export jobs')}
          />
        )
      ) : (
        <StandardView
          jobs={sortedJobs}
          maxItems={isCompact ? 5 : 15}
          showDownload={isWide}
          t={t}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 0,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  bigNumberLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  bigNumberRoot: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
  },
  bigNumberSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  bigNumberUnit: {
    color: colors.textSecondary,
    fontSize: 18,
  },
  bigNumberValue: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
  },
  bigNumberValueNull: {
    color: colors.textMuted,
  },
  bigNumberValueRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 4,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  downloadButton: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  downloadSpacer: {
    flexShrink: 0,
    width: 44,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  fileSize: {
    color: colors.textSecondary,
    flexShrink: 0,
    fontFamily: MONO,
    fontSize: 12,
    textAlign: 'right',
    width: 64,
  },
  filename: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 12,
    minWidth: 0,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  list: {
    flex: 1,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  progressWrap: {
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  shell: {
    flex: 1,
  },
  shellPulse: {
    elevation: 6,
    shadowColor: '#22c55e',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 120,
  },
  statusBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 52,
  },
  tabularNums: {
    fontFamily: MONO,
  },
  timeText: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'right',
  },
  timeWrap: {
    alignItems: 'flex-end',
    flexShrink: 0,
    width: 56,
  },
  title: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
});
