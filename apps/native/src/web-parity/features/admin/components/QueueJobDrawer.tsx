// Native parity port of
// web/src/features/admin/components/QueueJobDrawer.tsx.
//
// The web component is a slide-in side panel that lists the most recent jobs
// for a single worker. The fetch is gated on `open` via TanStack's `enabled`
// option (a closed drawer never burns a network call), and the loading, error,
// and empty states each carry a deterministic data-testid for the companion
// test file. It is reproduced here with React Native primitives, preserving the
// `QueueJobDrawerProps` (`worker`/`displayName`/`open`/`onClose`/
// `testHookOverride`), the stable `useQueueJobs(worker ?? '__none__', { enabled
// })` call + `testHookOverride ?? liveQuery` selection, the `data`/`isLoading`/
// `error`/`jobs` derivations (all gated on `open`), the `STATUS_TONE` map +
// `statusToneClass` lookup, the verbatim `QueueJobRow` `durationLabel` logic,
// every `queueStatus.*` i18n key + interpolation, and all testIDs:
//
//   - `@/components/ui` `Drawer` (a framer-motion + react-dom `createPortal`
//     side-sheet with focus-trap and Esc-to-close) is browser-only. It becomes a
//     native `<Modal transparent animationType="slide">` bottom sheet — the Modal
//     supplies the portal-to-root, `onRequestClose` wires the Android back button
//     as the native analog of the web Esc/overlay close, and a full-screen
//     backdrop `Pressable` closes on tap (mirroring the web overlay-click-to-
//     close). The Drawer's own chrome (title bar + ✕ close button) is reproduced
//     natively; its hard-coded aria-label="Close" becomes a native-local English
//     accessibilityLabel, since that label lives in the Drawer primitive rather
//     than this source file.
//   - `@/components/ui/Typography` `Text`/`Caption` (DOM <span> with token
//     classes) become `AppText`: web `bodySm` (text-xs/text-secondary) and
//     `caption` (text-xs/text-muted) both map to the 12px caption variant with
//     the matching tone, and per-call color overrides (status tone, rose error
//     copy) are preserved.
//   - `@/components/feedback` `Spinner` is the already-ported native parity
//     Spinner; `size="sm"` is preserved for the loading row.
//   - lucide-react `AlertTriangle` becomes the ⚠ warning glyph in AppText (the
//     same glyph-marker precedent used by the ActionItem/StatusHero ports), kept
//     aria-hidden via accessibilityElementsHidden.
//   - `formatDateTime` / `formatDurationMsLong` from `@/lib/dateFormat` are
//     inlined as native-safe ports (same "—" fallback contract, same
//     ms/sec/min branching, same en-US `formatRoundedInt`), matching the
//     ChartTooltip parity precedent — the shared lib is not yet ported.
//   - react-i18next `useTranslation` is not a native-parity dependency; a local
//     t() shim returns the fallback and resolves `{{token}}` interpolation,
//     preserving every `queueStatus.*` key + English copy verbatim.

import React, { useCallback } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, shadows, spacing } from '../../../../theme/tokens';
import { useQueueJobs } from '../../../api/hooks/useSystemQueues';
import type { QueueJobView } from '../../../api/types';
import { Spinner } from '../../../components/feedback/Spinner';

/* ─── i18n fallback shim with `{{token}}` interpolation ────────────────────── */

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

/* ─── native-safe date/duration formatting (web `@/lib/dateFormat`) ────────── */

const FALLBACK = '—';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

// Full date + time: "Apr 4, 2026, 2:30 AM" — returns the "—" placeholder for
// null/undefined or unparseable input, matching the web formatter contract.
function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return FALLBACK;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return FALLBACK;
  }
  return date.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// "920ms", "4.2s", or "1m 30s" — "—" for non-finite or non-positive input.
function formatDurationMsLong(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms <= 0) {
    return FALLBACK;
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

/* ─── status tone (web STATUS_TONE / statusToneClass) ──────────────────────── */

// Toned-down tailwind-300 hues, preserved as literals (the web maps each job
// status to a text-{tone}-300 class; cancelled/skipped fall back to muted).
const EMERALD_300 = '#6ee7b7';
const AMBER_300 = '#fcd34d';
const ROSE_300 = '#fda4af';
const CYAN_300 = '#67e8f9';
const ROSE_200 = '#fecdd3';

const STATUS_TONE: Record<string, string> = {
  // notification
  sent: EMERALD_300,
  pending: AMBER_300,
  deferred_dnd: AMBER_300,
  failed: ROSE_300,

  // export
  ready: EMERALD_300,
  queued: AMBER_300,
  processing: CYAN_300,

  // automation
  success: EMERALD_300,
  partial: AMBER_300,
  running: CYAN_300,
  cancelled: colors.textMuted,
  skipped: colors.textMuted,
};

function statusToneColor(status: string): string {
  return STATUS_TONE[status] ?? colors.textPrimary;
}

/* ─── QueueJobRow ──────────────────────────────────────────────────────────── */

interface QueueJobRowProps {
  job: QueueJobView;
}

function QueueJobRow({ job }: QueueJobRowProps) {
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

  const startedLabel = t('queueStatus.jobStarted', 'Started {{at}}', {
    at: formatDateTime(job.started_at),
  });
  const durationSuffix = durationLabel
    ? ` · ${t('queueStatus.jobDuration', 'Took {{duration}}', {
        duration: durationLabel,
      })}`
    : '';

  return (
    <View style={styles.row} testID={`queue-job-row-${job.id}`}>
      <View style={styles.rowHeader}>
        <AppText
          numberOfLines={1}
          style={styles.rowTitle}
          tone="secondary"
          variant="caption"
        >
          {job.title || job.id}
        </AppText>
        <AppText
          style={{ color: statusToneColor(job.status) }}
          testID={`queue-job-status-${job.id}`}
          variant="caption"
        >
          {t(`queueStatus.jobStatus.${job.status}`, job.status)}
        </AppText>
      </View>
      <AppText style={styles.rowMeta} tone="muted" variant="caption">
        {startedLabel + durationSuffix}
      </AppText>
      {job.error ? (
        <View style={styles.rowError} testID={`queue-job-error-${job.id}`}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.rowErrorIcon}
          >
            {'\u26A0'}
          </AppText>
          <AppText style={styles.rowErrorText} variant="caption">
            {job.error}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

QueueJobRow.displayName = 'QueueJobRow';

/* ─── QueueJobDrawer ───────────────────────────────────────────────────────── */

export interface QueueJobDrawerProps {
  worker: string | null;
  displayName?: string;
  open: boolean;
  onClose: () => void;
  /** Override the fetch hook for Storybook / tests. */
  testHookOverride?: ReturnType<typeof useQueueJobs>;
}

export function QueueJobDrawer({
  worker,
  displayName,
  open,
  onClose,
  testHookOverride,
}: QueueJobDrawerProps) {
  const t = useNativeTranslationFallback();
  // useQueueJobs requires a string identifier. When the drawer is
  // closed we still need to render a stable hook call, so pass an
  // empty placeholder and gate the network with enabled=false.
  const liveQuery = useQueueJobs(worker ?? '__none__', {
    enabled: Boolean(open && worker && !testHookOverride),
  });
  const query = testHookOverride ?? liveQuery;

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
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={open}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View
          accessibilityViewIsModal
          style={styles.drawer}
          testID="queue-job-drawer"
        >
          <View style={styles.header}>
            <AppText style={styles.title} variant="title" weight="bold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={styles.closeButton}
            >
              <AppText importantForAccessibility="no" style={styles.closeGlyph}>
                {'\u2715'}
              </AppText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            style={styles.bodyScroll}
          >
            <View testID="queue-job-drawer-body">
              {isLoading ? (
                <View
                  style={styles.loadingRow}
                  testID="queue-job-drawer-loading"
                >
                  <Spinner size="sm" />
                  <AppText tone="secondary" variant="caption">
                    {t('queueStatus.drawer.loading', 'Loading recent jobs…')}
                  </AppText>
                </View>
              ) : error ? (
                <View
                  style={styles.drawerError}
                  testID="queue-job-drawer-error"
                >
                  <AppText
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.drawerErrorIcon}
                  >
                    {'\u26A0'}
                  </AppText>
                  <AppText style={styles.drawerErrorText} variant="caption">
                    {t(
                      'queueStatus.drawer.error',
                      'Could not load recent jobs. Check API logs and try again.',
                    )}
                  </AppText>
                </View>
              ) : jobs.length === 0 ? (
                <AppText
                  style={styles.emptyText}
                  testID="queue-job-drawer-empty"
                  tone="secondary"
                  variant="caption"
                >
                  {t(
                    'queueStatus.drawer.empty',
                    'No recent jobs to show. New jobs will appear here as the worker processes them.',
                  )}
                </AppText>
              ) : (
                <View style={styles.list} testID="queue-job-drawer-list">
                  {jobs.map(job => (
                    <QueueJobRow job={job} key={job.id} />
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

QueueJobDrawer.displayName = 'QueueJobDrawer';

export default QueueJobDrawer;

// rose-500/30 border + rose-500/5 surface, preserved as literals (rose-500 =
// #f43f5e). The row surface is --surface-1 (#0f1019) at 40% opacity.
const ROSE_500_BORDER = 'rgba(244, 63, 94, 0.3)';
const ROSE_500_SURFACE = 'rgba(244, 63, 94, 0.05)';
const ROW_BORDER = 'rgba(255, 255, 255, 0.06)';
const ROW_SURFACE = 'rgba(15, 16, 25, 0.4)';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    paddingBottom: spacing.md,
  },
  bodyScroll: {
    flexShrink: 1,
  },
  closeButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  closeGlyph: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 22,
  },
  drawer: {
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: '92%',
    padding: spacing.lg,
    width: '100%',
    ...shadows.panel,
  },
  drawerError: {
    alignItems: 'flex-start',
    backgroundColor: ROSE_500_SURFACE,
    borderColor: ROSE_500_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  drawerErrorIcon: {
    color: ROSE_300,
    fontSize: 16,
    marginTop: 1,
  },
  drawerErrorText: {
    color: ROSE_200,
    flex: 1,
  },
  emptyText: {
    fontStyle: 'italic',
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  list: {
    gap: spacing.sm,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: 24,
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  row: {
    backgroundColor: ROW_SURFACE,
    borderColor: ROW_BORDER,
    borderRadius: 6,
    borderWidth: 1,
    padding: spacing.md,
  },
  rowError: {
    alignItems: 'flex-start',
    backgroundColor: ROSE_500_SURFACE,
    borderColor: ROSE_500_BORDER,
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  rowErrorIcon: {
    color: ROSE_300,
    fontSize: 14,
    marginTop: 1,
  },
  rowErrorText: {
    color: ROSE_200,
    flex: 1,
  },
  rowHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  rowMeta: {
    marginTop: spacing.xs,
  },
  rowTitle: {
    flexShrink: 1,
    fontWeight: '500',
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
  },
});
