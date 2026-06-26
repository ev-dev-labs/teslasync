/**
 * QueueStatusPanel — native parity port of
 * web/src/features/admin/components/QueueStatusPanel.tsx.
 *
 * Operator-facing view of the background worker fleet. Renders one card per
 * known worker (notification, export, automation) with:
 *
 *   • heartbeat-staleness severity badge (ok / warn / critical / down)
 *   • pending + in-progress depth (rendered through a MetricBar)
 *   • succeeded / failed counts over the last 24 hours
 *   • oldest-pending age (when there is a backlog)
 *   • host + version reported by the worker process
 *
 * Tapping a card opens the job-history drawer with the most recent jobs for
 * that worker. Auto-refresh + pause-when-backgrounded semantics live inside
 * useQueueStatus — the panel stays purely presentational so tests can drive it
 * with stub data via the testHookOverride prop.
 *
 * Native adaptations vs. the web source (behavior/state/keys/API intent kept):
 *   - web `@/components/ui` `GlassPanel` -> the canonical native `GlassPanel`.
 *   - web `@/components/ui` `Button` (variant=ghost, loading, disabled, icon)
 *     -> a Pressable refresh control: ActivityIndicator while a background
 *     refetch is in flight (`isFetching && !isLoading`), a ↻ glyph otherwise,
 *     same `disabled={isFetching}` gating and testID.
 *   - web Typography `Heading`/`Text`/`Caption` -> `AppText` (variant + tone +
 *     weight + style overrides).
 *   - web `data-display` `MetricBar` (framer-motion animated gradient bar) ->
 *     a self-contained RN MetricBar (static track + color fill; the spring
 *     width animation + gradient/glow are dropped — RN has no linear-gradient
 *     without a lib — the per-severity solid color preserves the visual cue).
 *   - web `feedback` `Spinner` -> RN `ActivityIndicator`.
 *   - lucide-react `RefreshCw`/`AlertTriangle`/`ChevronRight` (DOM SVG) -> the
 *     ↻ / ⚠ / › text glyphs (matching the EntryDrawer glyph approach).
 *   - sibling `./QueueJobDrawer` is not yet present in the native parity tree,
 *     so its behavior is self-contained here as an RN `Modal` right-edge drawer
 *     (same useQueueJobs(worker, {enabled}) gating, loading/error/empty/list
 *     states, per-job status tone, "Started … · Took …" line, and error box).
 *   - `@/lib/numberFormat` `fmtNumber` and `@/lib/dateFormat`
 *     `formatRelative`/`formatDateTime`/`formatDurationMsLong` are ported inline
 *     (same locale-aware + safeNumber + "—" fallback semantics; fmtNumber keeps
 *     the module default precision of 2).
 *   - react-i18next `useTranslation` -> a native-safe t(key, fallback, options?)
 *     fallback preserving every key, English default, and {{...}} interpolation.
 *   - all snake_case API field names, state names (openWorker), the
 *     testHookOverride prop, and the SEVERITY_COLOR hex map are preserved.
 */

import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing, typography} from '../../../../theme/tokens';
import {useQueueJobs, useQueueStatus} from '../../../api/hooks/useSystemQueues';
import type {
  QueueHeartbeatSeverity,
  QueueJobView,
  QueueStat,
} from '../../../../api/types';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
}

// ---- Ported number/date formatting -----------------------------------------

/** web numberFormat.safeNumber — 0 for nullish / non-finite input. */
function safeNumber(value: unknown): number {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

/** web numberFormat.isFiniteNumber. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Module-default decimal precision + locale (web useSettings would override
// these at runtime; the standalone port keeps the source defaults).
const NUMBER_PRECISION = 2;
const NUMBER_LOCALE = 'en-US';

/** web numberFormat.fmtNumber — locale-aware, module-default precision 2. */
function fmtNumber(value: unknown, decimals: number = NUMBER_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(NUMBER_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

/** web dateFormat.formatRoundedInt — whole number, en-US grouping. */
function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** web dateFormat.formatDate — "Apr 4, 2026". */
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** web dateFormat.formatDateTime — "Apr 4, 2026, 2:30 AM". */
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** web dateFormat.formatRelative — "3m ago", "2h ago", "yesterday", date. */
function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const now = Date.now();
  const diff = now - d.getTime();
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

/** web dateFormat.formatDurationMsLong — "750ms", "12.3s", "4m 09s". */
function formatDurationMsLong(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms <= 0) {
    return '—';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(1)}s`;
  }
  const min = Math.floor(sec / 60);
  return `${min}m ${formatRoundedInt(sec % 60)}s`;
}

// ---- Severity + status color maps (web SEVERITY_COLOR / tone classes) --------

// Severity -> hex color fed into MetricBar. Hex (not CSS vars) keeps the
// per-row dynamic color working, matching the web chart-color exception.
const SEVERITY_COLOR: Record<QueueHeartbeatSeverity, string> = {
  ok: '#10b981', // emerald-500
  warn: '#f59e0b', // amber-500
  critical: '#ef4444', // red-500
  down: '#94a3b8', // slate-400
};

// Toned-down text color per severity (web text-emerald-300 / amber-300 /
// rose-300 / --text-muted).
const SEVERITY_TONE_COLOR: Record<QueueHeartbeatSeverity, string> = {
  ok: '#6ee7b7', // emerald-300
  warn: '#fcd34d', // amber-300
  critical: '#fda4af', // rose-300
  down: colors.textMuted,
};

// Per-job status tone (web STATUS_TONE in QueueJobDrawer).
const STATUS_TONE_COLOR: Record<string, string> = {
  // notification
  sent: '#6ee7b7',
  pending: '#fcd34d',
  deferred_dnd: '#fcd34d',
  failed: '#fda4af',
  // export
  ready: '#6ee7b7',
  queued: '#fcd34d',
  processing: '#67e8f9', // cyan-300
  // automation
  success: '#6ee7b7',
  partial: '#fcd34d',
  running: '#67e8f9',
  cancelled: colors.textMuted,
  skipped: colors.textMuted,
};

function statusToneColor(status: string): string {
  return STATUS_TONE_COLOR[status] ?? colors.textPrimary;
}

const EMERALD_300 = '#6ee7b7';
const ROSE_300 = '#fda4af';
const ROSE_200 = '#fecdd3';
const AMBER_SOFT = 'rgba(252, 211, 77, 0.82)';
const GLASS_BORDER = 'rgba(255, 255, 255, 0.06)';

// ---- MetricBar (web data-display MetricBar) ---------------------------------

function MetricBar({
  value,
  max,
  color,
  label,
  sublabel,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  sublabel?: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <View>
      <View style={styles.metricBarRow}>
        <AppText style={styles.metricBarLabel}>{label}</AppText>
        <AppText style={[styles.metricBarSub, {color}]}>
          {sublabel ?? fmtNumber(value)}
        </AppText>
      </View>
      <View style={styles.metricBarTrack}>
        <View
          style={[styles.metricBarFill, {width: `${pct}%`, backgroundColor: color}]}
        />
      </View>
    </View>
  );
}

// ---- Worker card -------------------------------------------------------------

interface WorkerCardProps {
  stat: QueueStat;
  onOpen: (worker: string) => void;
}

function WorkerCard({stat, onOpen}: WorkerCardProps) {
  const t = useNativeTranslationFallback();
  const tone = SEVERITY_TONE_COLOR[stat.heartbeat_severity];
  const color = SEVERITY_COLOR[stat.heartbeat_severity];
  const total = stat.pending + stat.in_progress;

  const severityLabel = t(
    `queueStatus.severity.${stat.heartbeat_severity}`,
    stat.heartbeat_severity,
  );

  const lastBeatLabel = useMemo(() => {
    if (!stat.last_heartbeat_at) {
      return t('queueStatus.heartbeatNever', 'No heartbeat recorded');
    }
    return t('queueStatus.heartbeatRelative', 'Last beat {{when}}', {
      when: formatRelative(stat.last_heartbeat_at),
    });
  }, [stat.last_heartbeat_at, t]);

  const oldestLabel = useMemo(() => {
    if (stat.oldest_pending_age_seconds <= 0) {
      return null;
    }
    return t('queueStatus.oldestPending', 'Oldest pending: {{duration}}', {
      duration: formatDurationMsLong(stat.oldest_pending_age_seconds * 1000),
    });
  }, [stat.oldest_pending_age_seconds, t]);

  const handleOpen = () => onOpen(stat.worker);

  return (
    <Pressable
      accessibilityLabel={t(
        'queueStatus.openDrawer',
        'Show recent {{worker}} jobs',
        {worker: stat.display_name},
      )}
      accessibilityRole="button"
      onPress={handleOpen}
      style={({pressed}) => [styles.card, pressed && styles.cardPressed]}
      testID={`queue-worker-card-${stat.worker}`}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderText}>
          <AppText style={styles.cardTitle} weight="semibold">
            {stat.display_name}
          </AppText>
          <AppText
            numberOfLines={1}
            style={styles.cardHost}
            tone="muted"
            variant="caption">
            {stat.host
              ? t('queueStatus.hostVersion', '{{host}} · {{version}}', {
                  host: stat.host,
                  version:
                    stat.version ||
                    t('queueStatus.versionUnknown', 'unknown'),
                })
              : t('queueStatus.hostUnknown', 'No host reported')}
          </AppText>
        </View>
        <View style={styles.cardHeaderRight}>
          <AppText
            style={[styles.severity, {color: tone}]}
            testID={`queue-severity-${stat.worker}`}
            variant="caption">
            {severityLabel}
          </AppText>
          <AppText style={styles.chevron}>›</AppText>
        </View>
      </View>

      <View style={styles.metricWrap}>
        <MetricBar
          color={color}
          label={t('queueStatus.queueDepth', 'Queue depth')}
          max={total > 0 ? total : 1}
          sublabel={t(
            'queueStatus.queueDepthDetail',
            '{{pending}} pending · {{inProgress}} in progress',
            {
              pending: fmtNumber(stat.pending),
              inProgress: fmtNumber(stat.in_progress),
            },
          )}
          value={total}
        />
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCell}>
          <AppText tone="muted" variant="caption">
            {t('queueStatus.metric.succeeded24h', 'Succeeded 24h')}
          </AppText>
          <AppText
            style={styles.succeeded}
            testID={`queue-succeeded-${stat.worker}`}
            variant="caption"
            weight="semibold">
            {fmtNumber(stat.succeeded_24h)}
          </AppText>
        </View>
        <View style={styles.statCell}>
          <AppText tone="muted" variant="caption">
            {t('queueStatus.metric.failed24h', 'Failed 24h')}
          </AppText>
          <AppText
            style={stat.failed_24h > 0 ? styles.failed : styles.failedZero}
            testID={`queue-failed-${stat.worker}`}
            variant="caption"
            weight="semibold">
            {fmtNumber(stat.failed_24h)}
          </AppText>
        </View>
      </View>

      <View style={styles.heartbeatWrap}>
        <AppText
          style={[styles.heartbeat, {color: tone}]}
          testID={`queue-heartbeat-${stat.worker}`}
          variant="caption">
          {stat.heartbeat_detail || lastBeatLabel}
        </AppText>
        {oldestLabel ? (
          <AppText style={styles.oldest} variant="caption">
            {oldestLabel}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

// ---- Inlined job-history drawer (web sibling ./QueueJobDrawer) ---------------

function QueueJobRow({job}: {job: QueueJobView}) {
  const t = useNativeTranslationFallback();

  const durationLabel =
    typeof job.duration_ms === 'number'
      ? formatDurationMsLong(job.duration_ms)
      : job.finished_at
        ? formatDurationMsLong(
            new Date(job.finished_at).getTime() -
              new Date(job.started_at).getTime(),
          )
        : null;

  return (
    <View style={styles.jobRow} testID={`queue-job-row-${job.id}`}>
      <View style={styles.jobRowHeader}>
        <AppText
          numberOfLines={1}
          style={styles.jobTitle}
          variant="caption"
          weight="semibold">
          {job.title || job.id}
        </AppText>
        <AppText
          style={[styles.jobStatus, {color: statusToneColor(job.status)}]}
          testID={`queue-job-status-${job.id}`}
          variant="caption">
          {t(`queueStatus.jobStatus.${job.status}`, job.status)}
        </AppText>
      </View>
      <AppText style={styles.jobMeta} tone="muted" variant="caption">
        {t('queueStatus.jobStarted', 'Started {{at}}', {
          at: formatDateTime(job.started_at),
        })}
        {durationLabel
          ? ` · ${t('queueStatus.jobDuration', 'Took {{duration}}', {
              duration: durationLabel,
            })}`
          : ''}
      </AppText>
      {job.error ? (
        <View style={styles.jobError} testID={`queue-job-error-${job.id}`}>
          <AppText style={styles.jobErrorGlyph}>⚠</AppText>
          <AppText style={styles.jobErrorText} variant="caption">
            {job.error}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

interface QueueJobDrawerProps {
  worker: string | null;
  displayName?: string;
  open: boolean;
  onClose: () => void;
}

function QueueJobDrawer({worker, displayName, open, onClose}: QueueJobDrawerProps) {
  const t = useNativeTranslationFallback();
  const {width} = useWindowDimensions();
  const panelWidth = Math.min(448, width);

  // useQueueJobs requires a string identifier. When the drawer is closed we
  // still render a stable hook call, so pass a placeholder and gate the
  // network with enabled=false.
  const query = useQueueJobs(worker ?? '__none__', {
    enabled: Boolean(open && worker),
  });

  const data = query.data;
  const isLoading = query.isLoading && open;
  const error = query.error && open ? query.error : null;
  const jobs = data?.jobs ?? [];

  const title = displayName
    ? t('queueStatus.drawer.titleWithWorker', 'Recent {{worker}} jobs', {
        worker: displayName,
      })
    : t('queueStatus.drawer.title', 'Recent jobs');

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.drawerOverlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          accessibilityLabel={title}
          accessibilityViewIsModal
          accessible
          style={[styles.drawerPanel, {width: panelWidth}]}
          testID="queue-job-drawer">
          <View style={styles.drawerHeader}>
            <AppText
              numberOfLines={1}
              style={styles.drawerTitle}
              weight="semibold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.close', 'Close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({pressed}) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.closeGlyph} weight="bold">
                ✕
              </AppText>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.drawerBodyContent}
            style={styles.drawerBody}
            testID="queue-job-drawer-body">
            {isLoading ? (
              <View style={styles.loadingRow} testID="queue-job-drawer-loading">
                <ActivityIndicator color={colors.accent} size="small" />
                <AppText tone="secondary" variant="caption">
                  {t('queueStatus.drawer.loading', 'Loading recent jobs…')}
                </AppText>
              </View>
            ) : error ? (
              <View style={styles.errorBox} testID="queue-job-drawer-error">
                <AppText style={styles.errorGlyph}>⚠</AppText>
                <AppText style={styles.errorText} variant="caption">
                  {t(
                    'queueStatus.drawer.error',
                    'Could not load recent jobs. Check API logs and try again.',
                  )}
                </AppText>
              </View>
            ) : jobs.length === 0 ? (
              <AppText
                style={styles.italic}
                testID="queue-job-drawer-empty"
                tone="secondary"
                variant="caption">
                {t(
                  'queueStatus.drawer.empty',
                  'No recent jobs to show. New jobs will appear here as the worker processes them.',
                )}
              </AppText>
            ) : (
              <View style={styles.jobList} testID="queue-job-drawer-list">
                {jobs.map((job) => (
                  <QueueJobRow job={job} key={job.id} />
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---- Panel -------------------------------------------------------------------

export interface QueueStatusPanelProps {
  /** Override the auto-refresh hook for Storybook / tests. */
  testHookOverride?: ReturnType<typeof useQueueStatus>;
}

export function QueueStatusPanel({
  testHookOverride,
}: QueueStatusPanelProps = {}) {
  const t = useNativeTranslationFallback();
  const liveQuery = useQueueStatus({enabled: !testHookOverride});
  const query = testHookOverride ?? liveQuery;

  const data = query.data;
  const isLoading = query.isLoading;
  const isFetching = query.isFetching;
  const error = query.error;
  const refetch = query.refetch;

  const workers = data?.workers ?? [];

  const updatedLabel = useMemo(() => {
    if (!data?.generated_at) {
      return null;
    }
    return t('queueStatus.lastUpdated', 'Updated {{when}}', {
      when: formatRelative(data.generated_at),
    });
  }, [data?.generated_at, t]);

  const [openWorker, setOpenWorker] = useState<string | null>(null);
  const openStat = workers.find((w) => w.worker === openWorker) ?? null;

  const refreshing = isFetching && !isLoading;

  return (
    <GlassPanel style={styles.panel} testID="queue-status-panel">
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <AppText style={styles.title} weight="bold">
            {t('queueStatus.title', 'Background workers')}
          </AppText>
          <AppText style={styles.subtitle} tone="secondary" variant="caption">
            {t(
              'queueStatus.subtitle',
              'Live view of the notification, export, and automation worker queues. Heartbeat colour switches from green to amber after 60 seconds and to red after 5 minutes of silence; "down" means the worker has never reported in.',
            )}
          </AppText>
          {updatedLabel ? (
            <AppText style={styles.updated} tone="muted" variant="caption">
              {updatedLabel}
            </AppText>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel={t('queueStatus.refresh', 'Refresh')}
          accessibilityRole="button"
          accessibilityState={{busy: refreshing, disabled: isFetching}}
          disabled={isFetching}
          onPress={() => {
            void refetch();
          }}
          style={({pressed}) => [
            styles.refreshButton,
            isFetching && styles.disabled,
            pressed && !isFetching && styles.pressed,
          ]}
          testID="queue-refresh-button">
          {refreshing ? (
            <ActivityIndicator color={colors.textSecondary} size="small" />
          ) : (
            <AppText style={styles.refreshGlyph}>↻</AppText>
          )}
          <AppText style={styles.refreshLabel} variant="caption" weight="semibold">
            {t('queueStatus.refresh', 'Refresh')}
          </AppText>
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.loadingRow} testID="queue-loading">
          <ActivityIndicator color={colors.accent} size="small" />
          <AppText tone="secondary" variant="caption">
            {t('queueStatus.loading', 'Loading worker status…')}
          </AppText>
        </View>
      ) : error ? (
        <View style={styles.errorBox} testID="queue-error">
          <AppText style={styles.errorGlyph}>⚠</AppText>
          <AppText style={styles.errorText} variant="caption">
            {t(
              'queueStatus.error',
              'Could not load worker status. Check API logs and try again.',
            )}
          </AppText>
        </View>
      ) : workers.length === 0 ? (
        <AppText
          style={styles.italic}
          testID="queue-empty"
          tone="secondary"
          variant="caption">
          {t(
            'queueStatus.empty',
            'No workers are currently registered. The notification, export, and automation processes report here once they start.',
          )}
        </AppText>
      ) : (
        <View style={styles.grid} testID="queue-rows">
          {workers.map((stat) => (
            <WorkerCard key={stat.worker} onOpen={setOpenWorker} stat={stat} />
          ))}
        </View>
      )}

      <QueueJobDrawer
        displayName={openStat?.display_name}
        onClose={() => setOpenWorker(null)}
        open={Boolean(openStat)}
        worker={openStat?.worker ?? null}
      />
    </GlassPanel>
  );
}

QueueStatusPanel.displayName = 'QueueStatusPanel';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 14, 0.62)',
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: GLASS_BORDER,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  cardHeaderRight: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  cardHeaderText: {
    flexShrink: 1,
  },
  cardHost: {
    marginTop: 2,
  },
  cardPressed: {
    backgroundColor: colors.surfaceHover,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 18,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  closeGlyph: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 18,
  },
  disabled: {
    opacity: 0.48,
  },
  drawerBody: {
    flex: 1,
  },
  drawerBodyContent: {
    padding: spacing.lg,
  },
  drawerHeader: {
    alignItems: 'center',
    borderBottomColor: GLASS_BORDER,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  drawerOverlay: {
    backgroundColor: 'transparent',
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerPanel: {
    backgroundColor: colors.surface,
    borderLeftColor: GLASS_BORDER,
    borderLeftWidth: 1,
    flexDirection: 'column',
    height: '100%',
    ...shadows.panel,
  },
  drawerTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 18,
    lineHeight: 26,
  },
  errorBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorGlyph: {
    color: ROSE_300,
    fontSize: 14,
    lineHeight: 18,
  },
  errorText: {
    color: ROSE_200,
    flexShrink: 1,
  },
  failed: {
    color: ROSE_300,
  },
  failedZero: {
    color: colors.textPrimary,
  },
  grid: {
    gap: spacing.md,
  },
  heartbeat: {
    lineHeight: 18,
  },
  heartbeatWrap: {
    gap: 2,
  },
  italic: {
    fontStyle: 'italic',
  },
  jobError: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  jobErrorGlyph: {
    color: ROSE_300,
    fontSize: 13,
    lineHeight: 17,
  },
  jobErrorText: {
    color: ROSE_200,
    flexShrink: 1,
  },
  jobList: {
    gap: spacing.sm,
  },
  jobMeta: {
    marginTop: spacing.xs,
  },
  jobRow: {
    backgroundColor: colors.surfaceRaised,
    borderColor: GLASS_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
  },
  jobRowHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  jobStatus: {
    flexShrink: 0,
  },
  jobTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  metricBarFill: {
    borderRadius: 999,
    height: '100%',
  },
  metricBarLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '500',
  },
  metricBarRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  metricBarSub: {
    fontFamily: 'monospace',
    fontSize: typography.caption,
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceHover,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
  },
  metricWrap: {
    marginTop: spacing.xs,
  },
  oldest: {
    color: AMBER_SOFT,
  },
  panel: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  pressed: {
    opacity: 0.82,
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  refreshGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 18,
  },
  refreshLabel: {
    color: colors.textSecondary,
  },
  severity: {
    lineHeight: 18,
  },
  statCell: {
    flex: 1,
    gap: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  subtitle: {
    lineHeight: 18,
  },
  succeeded: {
    color: EMERALD_300,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  updated: {
    marginTop: spacing.xs,
  },
});

export default QueueStatusPanel;
