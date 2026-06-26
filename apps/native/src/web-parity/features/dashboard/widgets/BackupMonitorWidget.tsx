// Native parity port of web/src/features/dashboard/widgets/BackupMonitorWidget.tsx.
//
// Dashboard widget that surfaces the latest database backup run (relative time,
// size, type, status) plus, in the wide layout, a scrollable list of the five
// most recent runs — all inside a widget shell (title + freshness chip +
// loading/error states). The web file pulls in browser-only dependencies that
// are absent from the native parity manifest (contract rules 4, 5 & 7); each is
// replaced with a React Native-safe equivalent and documented here + in the
// sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L60) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.backupMonitor.*', '<English>') call keeps its default copy +
//     translation-key intent (the established AlertFeedWidget/RecentActivity
//     port pattern).
//   - lucide-react `HardDrive` (web L3, L105, L135, L140) -> the shared native
//     SemanticIcon `hardDrive` glyph badge (lucide SVG has no native renderer).
//     The web title icon's emerald-400 tint collapses to the SemanticIcon
//     hardDrive badge (neutral tone); the storage/backup semantic intent
//     survives.
//   - `@/components/data-display` StatCard (web L4) -> the ported native
//     data-display StatCard (label + value card with skeleton state).
//   - `@/components/ui` Badge (web L5, L169, L203) -> inlined native Badge: the
//     success/warning/danger pill variants this widget uses, mapped to the
//     theme success/warning/danger surface+border+text tones. No native Badge
//     port exists yet, so the subset exercised here is inlined.
//   - `@/components/feedback` EmptyState (web L6, L104, L139) -> inlined
//     BackupEmptyState (hardDrive icon + muted message). The shared native
//     EmptyState requires a title and takes no icon, so the icon-only/no-title
//     web shape is reproduced inline (the AlertFeedWidget precedent).
//   - `@/api/hooks/useAdmin` useBackupRuns (web L7) -> the ported native
//     useBackupRuns hook (same '/backup/runs' query, same UseQueryResult
//     fields, same safeArray select).
//   - `@/lib/cn` cn (web L8) -> dropped; Tailwind className composition becomes
//     React Native StyleSheet arrays.
//   - `@/hooks/useDateFormat` formatDateTime (web L9, L61, L195) -> inlined
//     native-safe formatDateTime mirroring @/lib/dateFormat formatDateTime
//     (Intl toLocaleString {year,month,day,hour,minute}; '—' for null/invalid),
//     standing in for the locale/tz-aware hook (the DateTime port precedent).
//   - `./WidgetShell` WidgetShell (web L10) -> inlined native WidgetShell: the
//     web shell is a transparent flex container (the grid cell supplies chrome),
//     so it maps to a plain View with the same loading (Skeleton placeholder),
//     error (QueryError), header (icon + uppercase title + DataFreshness),
//     title-less overlay-freshness, and pulse-on-update glow behaviour. The
//     unused query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./types` WidgetProps (web L11) -> inlined native WidgetSize/WidgetProps
//     (the size.cols subset this widget reads).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported -- only react, react-native
// primitives (ScrollView/StyleSheet/View), and the shared native SemanticIcon /
// AppText / theme tokens plus the ported parity StatCard / DataFreshness /
// QueryError / useBackupRuns.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useBackupRuns} from '../../../api/hooks/useAdmin';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {StatCard} from '../../../components/data-display/StatCard';
import {QueryError} from '../../../components/feedback/QueryError';

type BackupStatus = 'completed' | 'failed' | 'running' | 'queued';

type BadgeVariant = 'success' | 'warning' | 'danger';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

function statusVariant(status: string): BadgeVariant {
  if (status === 'completed') return 'success';
  if (status === 'running' || status === 'queued') return 'warning';
  return 'danger';
}

function statusLabel(status: string, t: NativeTFunction): string {
  if (status === 'completed')
    return t('widget.backupMonitor.statusSuccess', 'Success');
  if (status === 'running')
    return t('widget.backupMonitor.statusRunning', 'Running');
  if (status === 'queued')
    return t('widget.backupMonitor.statusQueued', 'Queued');
  return t('widget.backupMonitor.statusFailed', 'Failed');
}

// Web returns Tailwind dot classes (bg-green-500 / bg-amber-400 / bg-red-500
// + glow). The native dot tracks the same status palette via the theme
// success(green)/warning(amber)/danger(red) tokens, keeping the dot colour
// aligned with the matching Badge variant; the shadow glow is omitted (no
// per-status dynamic shadow without an extra animation/style layer).
function statusDotColor(status: string): string {
  if (status === 'completed') return colors.success;
  if (status === 'running' || status === 'queued') return colors.warning;
  return colors.danger;
}

/** Format bytes into human-readable size (e.g. "1.2 GB", "450 MB"). */
function fmtBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

/** Format ISO timestamp as relative time (e.g. "2m ago", "3h ago", "5d ago"). */
function fmtRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── @/hooks/useDateFormat formatDateTime (ported inline, native-safe Intl) ──
// Mirrors @/lib/dateFormat formatDateTime: '—' for null/invalid, otherwise a
// locale-aware "Apr 4, 2026, 02:30 PM"-style date+time string.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── @/components/ui Badge (ported inline, native-safe subset) ──
interface BadgeProps {
  variant: BadgeVariant;
  small?: boolean;
  children: string;
}

function Badge({variant, small = false, children}: BadgeProps) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText
        style={[
          styles.badgeText,
          small && styles.badgeTextSmall,
          badgeTextColorStyles[variant],
        ]}
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ── @/components/feedback EmptyState (ported inline; icon + message, no title) ──
function BackupEmptyState({message}: {message: string}) {
  return (
    <View style={styles.empty}>
      <SemanticIcon decorative name="hardDrive" size="md" />
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
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
  // Pulse-on-data-change glow (web L59-80).
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
  // Compact (dot-only) when the widget has no title (typically 1×N widgets).
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

export default function BackupMonitorWidget({size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch} =
    useBackupRuns();

  const runs = useMemo(() => data ?? [], [data]);

  const sortedRuns = useMemo(
    () =>
      [...runs].sort(
        (a, b) =>
          new Date(b.completedAt ?? b.createdAt).getTime() -
          new Date(a.completedAt ?? a.createdAt).getTime(),
      ),
    [runs],
  );

  const latestRun = sortedRuns[0] ?? null;
  const latestStatus: BackupStatus = latestRun?.status ?? 'failed';

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const shellProps = {
    loading: isLoading,
    error: null as string | null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact layout (1×N) ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {runs.length === 0 && !isLoading ? (
          <BackupEmptyState
            message={t('widget.backupMonitor.noData', 'No backup data')}
          />
        ) : (
          <View style={styles.compactRow}>
            <View
              style={[
                styles.compactDot,
                {backgroundColor: statusDotColor(latestRun?.status ?? 'failed')},
              ]}
            />
            <View style={styles.compactText}>
              <AppText
                numberOfLines={1}
                style={styles.compactPrimary}
                weight="semibold">
                {fmtRelativeTime(
                  latestRun?.completedAt ?? latestRun?.createdAt ?? null,
                )}
              </AppText>
              <AppText numberOfLines={1} style={styles.compactCaption} tone="muted">
                {t('widget.backupMonitor.lastBackup', 'Last backup')}
              </AppText>
            </View>
          </View>
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×2) and Wide (2×4) layouts ──
  return (
    <WidgetShell
      icon={<SemanticIcon decorative name="hardDrive" size="sm" />}
      title={t('widget.backupMonitor.title', 'Backup Monitor')}
      {...shellProps}>
      {runs.length === 0 && !isLoading ? (
        <BackupEmptyState
          message={t('widget.backupMonitor.noData', 'No backup data')}
        />
      ) : (
        <View style={styles.standardBody}>
          {/* Stat card grid */}
          <View style={styles.grid}>
            <StatCard
              label={t('widget.backupMonitor.lastBackup', 'Last backup')}
              style={styles.gridCell}
              value={fmtRelativeTime(
                latestRun?.completedAt ?? latestRun?.createdAt ?? null,
              )}
            />
            <StatCard
              label={t('widget.backupMonitor.size', 'Backup Size')}
              style={styles.gridCell}
              value={fmtBytes(latestRun?.fileSize ?? 0)}
            />
            <StatCard
              label={t('widget.backupMonitor.type', 'Type')}
              style={styles.gridCell}
              value={latestRun?.backupType ?? '—'}
            />
            <View
              style={[
                styles.gridCell,
                styles.statusCell,
                latestStatus === 'failed' && styles.statusCellFailed,
              ]}>
              <AppText style={styles.statusLabel} tone="muted" variant="caption">
                {t('widget.backupMonitor.status', 'Status')}
              </AppText>
              <Badge variant={statusVariant(latestRun?.status ?? 'failed')}>
                {statusLabel(latestRun?.status ?? 'failed', t)}
              </Badge>
            </View>
          </View>

          {/* Wide layout: last 5 backup runs */}
          {isWide ? (
            <View style={styles.recentSection}>
              <AppText style={styles.sectionLabel} tone="muted" variant="caption">
                {t('widget.backupMonitor.recentRuns', 'Recent Runs')}
              </AppText>
              <ScrollView nestedScrollEnabled style={styles.recentList}>
                {sortedRuns.slice(0, 5).map(run => (
                  <View key={run.id} style={styles.recentRow}>
                    <View style={styles.recentRowLeft}>
                      <View
                        style={[
                          styles.recentDot,
                          {backgroundColor: statusDotColor(run.status)},
                        ]}
                      />
                      <View style={styles.recentRowText}>
                        <AppText numberOfLines={1} style={styles.recentTime}>
                          {formatDateTime(run.completedAt ?? run.createdAt)}
                        </AppText>
                        <AppText
                          numberOfLines={1}
                          style={styles.recentMeta}
                          tone="muted">
                          {`${fmtBytes(run.fileSize ?? 0)}${
                            run.durationMs != null ? ` · ${run.durationMs}ms` : ''
                          }`}
                        </AppText>
                      </View>
                    </View>
                    <Badge small variant={statusVariant(run.status)}>
                      {statusLabel(run.status, t)}
                    </Badge>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      )}
    </WidgetShell>
  );
}

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextColorStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  danger: {
    color: colors.danger,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  badgeTextSmall: {
    fontSize: 10,
    lineHeight: 14,
  },
  compactCaption: {
    fontSize: 10,
  },
  compactDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  compactPrimary: {
    fontSize: 14,
  },
  compactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 44,
  },
  compactText: {
    flexShrink: 1,
    minWidth: 0,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCell: {
    flexBasis: '47%',
    flexGrow: 1,
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
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  recentDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  recentList: {
    flex: 1,
  },
  recentMeta: {
    fontSize: 10,
  },
  recentRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 6,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recentRowLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 10,
    minWidth: 0,
  },
  recentRowText: {
    flexShrink: 1,
    minWidth: 0,
  },
  recentSection: {
    flex: 1,
    gap: 6,
    minHeight: 0,
  },
  recentTime: {
    fontSize: 12,
  },
  sectionLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
  standardBody: {
    flex: 1,
    gap: 12,
  },
  statusCell: {
    alignItems: 'flex-start',
    borderRadius: 16,
    justifyContent: 'center',
    padding: 16,
  },
  statusCellFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  statusLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginBottom: 4,
    textTransform: 'uppercase',
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
