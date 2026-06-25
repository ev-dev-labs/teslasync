// Native parity port of web/src/components/feedback/JobProgressDrawer.tsx.
//
// Floating, minimizable widget that surfaces in-flight + recently-finished
// export jobs. Auto-shows when there is at least one queued/processing job and
// stays open until the user dismisses it. Once minimized, a small chip shows
// the active count so the user can re-expand it. The drawer polls via the
// shared `useExportJobs` hook (5-second cadence while any job is queued/
// processing) — that hook is reused verbatim from the native parity API layer.
//
// The web component leans on browser-only deps that have no place in the native
// parity tree, so they are reproduced natively and kept self-contained here:
//   - react-i18next `useTranslation`        -> the shared native fallback hook
//     (key + English fallback + {{var}} interpolation); every t() key + English
//     fallback is copied verbatim, including the {{count}}/{{status}}/
//     {{relative}}/{{size}} interpolations.
//   - lucide-react icons (Download/X/Loader2/CheckCircle2/XCircle/Clock/Minus/
//     Maximize2/AlertTriangle/Package) -> small tinted glyph/`ActivityIndicator`
//     equivalents; the spinning Loader2 becomes a native ActivityIndicator and
//     each remaining icon keeps its semantic tone (muted/cyan/emerald/rose/
//     amber). The lucide identity is preserved per branch in the sidecar.
//   - `@/lib/cn`                            -> StyleSheet composition (dropped).
//   - `@/components/ui` Button              -> internal header icon Pressables.
//   - `@/lib/numberFormat` formatBytes      -> ported inline (binary units, no DOM).
//   - `@/lib/dateFormat` formatRelative     -> ported inline (identical buckets).
//   - browser `localStorage` persistence    -> a module-level in-memory store so
//     the open/minimized/dismissed choice survives remounts within the app
//     process (same intent as the web localStorage persistence).
//   - the `<a href target=_blank>` download  -> `Linking.openURL`, hitting the
//     same `exportDownloadUrl(job.id)` API path.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {
  exportDownloadUrl,
  useExportJobs,
  type ExportJobSummary,
} from '../../api/hooks/useExports';

// White-alpha borders / surfaces copied from the web Tailwind values so the
// glass drawer keeps its hairline edges and faint active-row wash.
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.08)';
const BORDER_FAINT = 'rgba(255, 255, 255, 0.06)';
const ROW_ACTIVE_BG = 'rgba(255, 255, 255, 0.02)';
const ACTIVE_PILL_BG = 'rgba(53, 213, 255, 0.1)'; // web bg-cyan-400/10

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function interpolate(template: string, values: TranslationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, values) =>
      values ? interpolate(fallback, values) : fallback,
    [],
  );
}

// ---- Ported formatters (web/src/lib numberFormat + dateFormat) --------------

interface FormatBytesOptions {
  zeroAsEmpty?: boolean;
  empty?: string;
  gbDecimals?: number;
}

/** Format a byte count with binary units. Mirrors web `formatBytes` exactly. */
function formatBytes(
  bytes: number | null | undefined,
  options: FormatBytesOptions = {},
): string {
  const empty = options.empty ?? '—';
  if (bytes == null || !Number.isFinite(bytes)) {
    return empty;
  }
  if (options.zeroAsEmpty && bytes === 0) {
    return empty;
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
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(options.gbDecimals ?? 1)} GB`;
}

/** Absolute date fallback used by `formatRelative` for deltas >= 7 days. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Relative time label ("just now", "5m ago", …). Mirrors web `formatRelative`. */
function formatRelative(iso: string | null | undefined): string {
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

// ---- Bucketing + persistence (web module-scope helpers) ---------------------

type JobBucket = 'active' | 'recent';

type DrawerState = 'open' | 'minimized' | 'dismissed';

/**
 * Native replacement for the web `localStorage` persistence keyed by
 * `teslasync.exportDrawer.state`. React Native has no localStorage, so the
 * open/minimized/dismissed choice persists for the current app process in a
 * module-level slot — surviving component remounts the same way the web
 * widget survives reloads.
 */
let nativeDrawerState: DrawerState | null = null;

function readPersistedState(): DrawerState {
  if (
    nativeDrawerState === 'open' ||
    nativeDrawerState === 'minimized' ||
    nativeDrawerState === 'dismissed'
  ) {
    return nativeDrawerState;
  }
  return 'minimized';
}

function writePersistedState(state: DrawerState): void {
  nativeDrawerState = state;
}

function isActive(job: ExportJobSummary): boolean {
  return job.status === 'queued' || job.status === 'processing';
}

function bucketFor(job: ExportJobSummary): JobBucket {
  return isActive(job) ? 'active' : 'recent';
}

// ---- Status icon (web lucide statusIcon) ------------------------------------

type SettledStatus = Exclude<ExportJobSummary['status'], 'processing'>;

/**
 * Glyph + tone per settled status, mirroring the web lucide icons:
 * Clock (queued, muted), CheckCircle2 (ready, emerald), XCircle (failed,
 * rose), AlertTriangle (expired, amber). The `processing` Loader2 spinner is
 * handled separately by an ActivityIndicator below.
 */
const STATUS_VISUAL: Record<SettledStatus, {glyph: string; color: string}> = {
  queued: {glyph: '○', color: colors.textMuted},
  ready: {glyph: '✓', color: colors.success},
  failed: {glyph: '✕', color: colors.danger},
  expired: {glyph: '!', color: colors.warning},
};

function StatusIcon({status}: {status: ExportJobSummary['status']}) {
  if (status === 'processing') {
    return <ActivityIndicator color={colors.accent} size="small" />;
  }
  // Unknown values fall back to the queued/Clock glyph, matching the web default.
  const visual = STATUS_VISUAL[status] ?? STATUS_VISUAL.queued;
  return (
    <AppText style={[styles.statusGlyph, {color: visual.color}]} weight="bold">
      {visual.glyph}
    </AppText>
  );
}

// ---- Public props -----------------------------------------------------------

export interface JobProgressDrawerProps {
  /**
   * Maximum number of recently-finished jobs to show alongside active jobs.
   * Defaults to 5.
   */
  maxRecent?: number;
  /** Web Tailwind className; retained for API parity but unused natively. */
  className?: string;
  /**
   * Native positioning override. Replaces the web `className` default of
   * `fixed bottom-4 right-4 z-40`; applied to the floating wrapper so callers
   * can re-anchor the widget. Defaults to absolute bottom-right.
   */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Floating, minimizable widget that surfaces in-flight + recently-finished
 * export jobs. Mount it once near the navigation root so it floats above the
 * active screen (the native equivalent of the web `fixed` overlay).
 */
export function JobProgressDrawer({
  maxRecent = 5,
  className: _className,
  style,
  testID,
}: JobProgressDrawerProps) {
  const t = useNativeTranslationFallback();
  const {data: jobs, isLoading} = useExportJobs();
  // Web wrote `const allJobs = jobs ?? []` inline; memoize the fallback so the
  // derived useMemo deps below stay referentially stable between renders.
  const allJobs = useMemo(() => jobs ?? [], [jobs]);
  const {height: windowHeight, width: windowWidth} = useWindowDimensions();

  const [state, setState] = useState<DrawerState>(() => readPersistedState());

  const activeJobs = useMemo(() => allJobs.filter(isActive), [allJobs]);
  const recentJobs = useMemo(
    () => allJobs.filter(j => !isActive(j)).slice(0, maxRecent),
    [allJobs, maxRecent],
  );

  // Auto-promote dismissed -> minimized when a NEW job appears so the user
  // notices it. Active jobs always force at least the minimized chip.
  useEffect(() => {
    if (activeJobs.length > 0 && state === 'dismissed') {
      setState('minimized');
      writePersistedState('minimized');
    }
  }, [activeJobs.length, state]);

  const persist = useCallback((next: DrawerState) => {
    setState(next);
    writePersistedState(next);
  }, []);

  // Hide the drawer entirely when there's nothing to show and the user has
  // dismissed it. The dashboard screen can still surface jobs without us.
  if (state === 'dismissed' && activeJobs.length === 0) {
    return null;
  }
  if (allJobs.length === 0 && !isLoading) {
    return null;
  }

  // Minimized: a small chip showing active count + tap to expand.
  if (state === 'minimized') {
    const activeCount = activeJobs.length;
    return (
      <View pointerEvents="box-none" style={[styles.position, style]}>
        <Pressable
          accessibilityLabel={t(
            'export.jobDrawer.expand',
            'Show export jobs ({{count}} active)',
            {count: activeCount},
          )}
          accessibilityRole="button"
          onPress={() => persist('open')}
          style={({pressed}) => [styles.chip, pressed && styles.chipPressed]}
          testID={testID ?? 'job-progress-drawer-chip'}>
          {activeCount > 0 ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <AppText style={styles.chipPackageGlyph} weight="bold">
              ▦
            </AppText>
          )}
          <AppText style={styles.chipText} weight="semibold">
            {activeCount > 0
              ? t('export.jobDrawer.activeCount', '{{count}} export running', {
                  count: activeCount,
                })
              : t('export.jobDrawer.recentLabel', 'Exports')}
          </AppText>
        </Pressable>
      </View>
    );
  }

  const drawerWidth = Math.min(360, windowWidth - 32);
  const bodyMaxHeight = Math.round(windowHeight * 0.6);

  return (
    <View pointerEvents="box-none" style={[styles.position, style]}>
      <View
        accessibilityLabel={t('export.jobDrawer.label', 'Export job progress')}
        accessible
        style={[styles.drawer, {width: drawerWidth}]}
        testID={testID ?? 'job-progress-drawer'}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <AppText style={styles.headerPackageGlyph} weight="bold">
              ▦
            </AppText>
            <AppText
              numberOfLines={1}
              style={styles.headerTitle}
              weight="semibold">
              {t('export.jobDrawer.title', 'Export jobs')}
            </AppText>
            {activeJobs.length > 0 ? (
              <View style={styles.activePill}>
                <AppText style={styles.activePillText} weight="semibold">
                  {t('export.jobDrawer.activePill', '{{count}} active', {
                    count: activeJobs.length,
                  })}
                </AppText>
              </View>
            ) : null}
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel={t('export.jobDrawer.minimize', 'Minimize')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => persist('minimized')}
              style={({pressed}) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}>
              <AppText style={styles.iconButtonGlyph} weight="bold">
                –
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={t('export.jobDrawer.close', 'Dismiss')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => persist('dismissed')}
              style={({pressed}) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
              ]}>
              <AppText style={styles.iconButtonGlyph} weight="bold">
                ✕
              </AppText>
            </Pressable>
          </View>
        </View>

        {/* Body */}
        <ScrollView
          style={[styles.body, {maxHeight: bodyMaxHeight}]}
          contentContainerStyle={styles.bodyContent}>
          {isLoading && allJobs.length === 0 ? (
            <AppText style={styles.loadingText}>
              {t('export.jobDrawer.loading', 'Loading export jobs…')}
            </AppText>
          ) : (
            <>
              <DrawerSection
                emptyLabel={t(
                  'export.jobDrawer.activeEmpty',
                  'No active exports',
                )}
                jobs={activeJobs}
                label={t('export.jobDrawer.activeHeading', 'In progress')}
                t={t}
              />
              <DrawerSection
                emptyLabel={t(
                  'export.jobDrawer.recentEmpty',
                  'No recent exports',
                )}
                jobs={recentJobs}
                label={t('export.jobDrawer.recentHeading', 'Recent')}
                t={t}
              />
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

JobProgressDrawer.displayName = 'JobProgressDrawer';

// ---- Section + row (web DrawerSection / JobRow) -----------------------------

function DrawerSection({
  label,
  emptyLabel,
  jobs,
  t,
}: {
  label: string;
  emptyLabel: string;
  jobs: ExportJobSummary[];
  t: NativeTFunction;
}) {
  return (
    <View style={styles.section}>
      <AppText style={styles.sectionLabel} weight="semibold">
        {label}
      </AppText>
      {jobs.length === 0 ? (
        <AppText style={styles.sectionEmpty}>{emptyLabel}</AppText>
      ) : (
        <View style={styles.jobList}>
          {jobs.map(job => (
            <JobRow job={job} key={job.id} t={t} />
          ))}
        </View>
      )}
    </View>
  );
}

function JobRow({job, t}: {job: ExportJobSummary; t: NativeTFunction}) {
  const bucket = bucketFor(job);

  const handleDownload = useCallback(() => {
    void Linking.openURL(exportDownloadUrl(job.id));
  }, [job.id]);

  return (
    <View style={[styles.jobRow, bucket === 'active' && styles.jobRowActive]}>
      <View style={styles.jobIcon}>
        <StatusIcon status={job.status} />
      </View>
      <View style={styles.jobMain}>
        <View style={styles.jobTitleRow}>
          <AppText numberOfLines={1} style={styles.jobType} weight="semibold">
            {prettyType(job.type, t)}
          </AppText>
          <AppText style={styles.jobFormat}>{job.format}</AppText>
        </View>
        <AppText numberOfLines={1} style={styles.jobSubtitle}>
          {bucket === 'active'
            ? t(
                'export.jobDrawer.statusLine',
                '{{status}} · started {{relative}}',
                {
                  status: prettyStatus(job.status, t),
                  relative: formatRelative(job.created_at),
                },
              )
            : t('export.jobDrawer.completedLine', '{{size}} · {{relative}}', {
                size:
                  formatBytes(job.file_size, {
                    zeroAsEmpty: true,
                    gbDecimals: 2,
                  }) || '—',
                relative: formatRelative(job.completed_at ?? job.created_at),
              })}
        </AppText>
        {job.error_message ? (
          <AppText numberOfLines={1} style={styles.jobError}>
            {job.error_message}
          </AppText>
        ) : null}
      </View>
      {job.status === 'ready' ? (
        <Pressable
          accessibilityLabel={t('export.jobDrawer.download', 'Download')}
          accessibilityRole="button"
          onPress={handleDownload}
          style={({pressed}) => [
            styles.downloadButton,
            pressed && styles.downloadButtonPressed,
          ]}>
          <AppText style={styles.downloadGlyph} weight="bold">
            ↓
          </AppText>
          <AppText style={styles.downloadText} weight="semibold">
            {t('export.jobDrawer.download', 'Download')}
          </AppText>
        </Pressable>
      ) : null}
      {job.status === 'failed' ? (
        <AppText style={styles.maximizeGlyph} weight="bold">
          ↗
        </AppText>
      ) : null}
    </View>
  );
}

// ---- Pretty-printers (web module-scope helpers) -----------------------------

function prettyType(type: string, t: NativeTFunction): string {
  switch (type) {
    case 'account':
      return t('export.types.account', 'Account export');
    case 'drives':
      return t('export.types.drives', 'Drives');
    case 'charging':
      return t('export.types.charging', 'Charging');
    case 'analytics':
      return t('export.types.analytics', 'Analytics');
    case 'backup':
      return t('export.types.backup', 'Backup');
    case 'import_drives':
      return t('export.types.importDrives', 'Import drives');
    case 'import_charging':
      return t('export.types.importCharging', 'Import charging');
    default:
      return type;
  }
}

function prettyStatus(
  status: ExportJobSummary['status'],
  t: NativeTFunction,
): string {
  switch (status) {
    case 'queued':
      return t('export.status.queued', 'Queued');
    case 'processing':
      return t('export.status.processing', 'Processing');
    case 'ready':
      return t('export.status.ready', 'Ready');
    case 'failed':
      return t('export.status.failed', 'Failed');
    case 'expired':
      return t('export.status.expired', 'Expired');
    default:
      return status;
  }
}

const styles = StyleSheet.create({
  activePill: {
    backgroundColor: ACTIVE_PILL_BG,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  activePillText: {
    color: colors.accent,
    fontSize: 10,
    lineHeight: 14,
  },
  body: {
    alignSelf: 'stretch',
  },
  bodyContent: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
  chip: {
    ...shadows.panel,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: BORDER_SUBTLE,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipPackageGlyph: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 16,
  },
  chipPressed: {
    backgroundColor: colors.surfaceHover,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  downloadButton: {
    alignItems: 'center',
    borderColor: BORDER_SUBTLE,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  downloadButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  downloadGlyph: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 14,
  },
  downloadText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  drawer: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: BORDER_SUBTLE,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: '100%',
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    borderBottomColor: BORDER_FAINT,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  headerPackageGlyph: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 18,
  },
  headerTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  iconButtonGlyph: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 16,
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  jobError: {
    color: colors.danger,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  jobFormat: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  jobIcon: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    minWidth: 16,
  },
  jobList: {
    gap: spacing.xs,
  },
  jobMain: {
    flex: 1,
    minWidth: 0,
  },
  jobRow: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  jobRowActive: {
    backgroundColor: ROW_ACTIVE_BG,
  },
  jobSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  jobTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  jobType: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  maximizeGlyph: {
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 14,
  },
  position: {
    bottom: 16,
    position: 'absolute',
    right: 16,
  },
  section: {
    gap: 2,
  },
  sectionEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 14,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    textTransform: 'uppercase',
  },
  statusGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
});
