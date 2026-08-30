import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useIsMutating, useMutationState } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useExportJobs, type ExportJobSummary } from '@/api/hooks/useExports';
import { getErrorMessage } from '@/lib/errorMessage';

/**
 * useBackgroundJobs.
 *
 * Single source of truth for background work and its recent outcome
 * surfaced by the footer status bar's BackgroundWorkSegment. Aggregates
 * three independent signals:
 *
 * 1. **Export jobs** — queued/processing entries from `/export/jobs`.
 * 2. **TanStack mutations** — anything calling `useMutation()` anywhere
 * in the app (CSV downloads, settings saves, alert rule edits, etc).
 * 3. **Ad-hoc registrations** — long-running operations that don't fit
 * either of the above can register themselves via {@link registerJob}
 * and call the returned function to clear themselves.
 *
 * The store is intentionally module-scoped + observable rather than a
 * React context so that any code path (handler, hook, callback) can call
 * `registerJob` without having to live inside a provider tree.
 */

export type BackgroundJobKind = 'export' | 'mutation' | 'custom';
export type BackgroundJobStatus = 'running' | 'success' | 'error';

export interface BackgroundJob {
  /** Stable id used for de-duplication. */
  id: string;
  /** Human-readable title shown in the popover (already i18n'd by the caller). */
  label: string;
  /** What kind of work this is — drives the icon shown in the popover. */
  kind: BackgroundJobKind;
  /** Current outcome — running rows persist, settled rows expire automatically. */
  status: BackgroundJobStatus;
  /** Optional secondary line shown beneath the label. */
  description?: string;
  /** ISO timestamp when this job was registered; used for sorting (oldest first). */
  startedAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Custom-job store (module-scoped pub/sub)
// ────────────────────────────────────────────────────────────────────────────

let customJobs: BackgroundJob[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): BackgroundJob[] {
  return customJobs;
}

/**
 * Register a custom long-running background job. Returns a function that
 * removes the registration when the job completes.
 *
 * Example — wrapping an imperative bulk-action call:
 *
 * ```ts
 * const done = registerJob({ id: 'backup', label: 'Generating backup' });
 * try { await runBackup() } finally { done() }
 * ```
 */
export function registerJob(
  input: Omit<BackgroundJob, 'startedAt' | 'kind' | 'status'> & {
    kind?: BackgroundJobKind;
  },
): () => void {
  // Spread the caller's input FIRST, then apply defaults last. Doing it the
  // other way round let an explicit `kind: undefined` on `input` clobber the
  // `?? 'custom'` fallback back to `undefined`, which then crashed the footer
  // popover's icon lookup (`KIND_ICON[undefined]`).
  const job: BackgroundJob = {
    ...input,
    kind: input.kind ?? 'custom',
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  // Replace any existing entry with the same id so re-registration is idempotent.
  customJobs = [...customJobs.filter((j) => j.id !== job.id), job];
  emit();
  return () => {
    customJobs = customJobs.filter((j) => j.id !== job.id);
    emit();
  };
}

/** Test-only helper: clear all custom registrations between tests. */
export function __clearBackgroundJobsForTests() {
  customJobs = [];
  emit();
}

// ────────────────────────────────────────────────────────────────────────────
// Hook
// ────────────────────────────────────────────────────────────────────────────

export interface UseBackgroundJobsResult {
  /** Combined list of in-flight jobs plus short-lived success/error outcomes. */
  jobs: BackgroundJob[];
  /** Convenience flag — true iff `jobs.length > 0`. */
  hasJobs: boolean;
  /** How many running or transient outcome rows are visible. */
  count: number;
}

function activeExportJobs(jobs: ExportJobSummary[] | undefined, t: TFunction): BackgroundJob[] {
  if (!jobs) return [];
  return jobs
    .filter((j) => j.status === 'queued' || j.status === 'processing')
    .map<BackgroundJob>((j) => ({
      id: `export:${j.id}`,
      kind: 'export',
      status: 'running',
      label:
        j.file_name ||
        t('statusBar.background.exportLabel', '{{type}} export', { type: j.type ?? '—' }),
      description:
        j.status === 'queued'
          ? t('statusBar.background.queued', 'Queued')
          : t('statusBar.background.processing', 'Processing'),
      // `created_at` is required by the API contract, but guard against a
      // malformed payload so the `.localeCompare` sort below can never throw
      // on an undefined `startedAt`.
      startedAt: j.created_at ?? '',
    }));
}

const SUCCESS_VISIBLE_MS = 8_000;
const ERROR_VISIBLE_MS = 15_000;

interface MutationSnapshot {
  mutationId: number;
  status: 'idle' | 'pending' | 'success' | 'error';
  submittedAt: number;
  error: unknown;
}

function mutationSettlementKey(mutation: MutationSnapshot): string {
  return `${mutation.mutationId}:${mutation.status}`;
}

function exportSettlementKey(job: ExportJobSummary): string {
  return `${job.id}:${job.status}`;
}

function recentExportJobs(
  jobs: ExportJobSummary[] | undefined,
  settledAtByKey: ReadonlyMap<string, number>,
  now: number,
  t: TFunction,
): BackgroundJob[] {
  if (!jobs) return [];
  return jobs
    .filter((job) => job.status === 'ready' || job.status === 'failed')
    .filter((job) => {
      const settledAt = settledAtByKey.get(exportSettlementKey(job)) ?? 0;
      if (settledAt <= 0) return false;
      const ttl = job.status === 'failed' ? ERROR_VISIBLE_MS : SUCCESS_VISIBLE_MS;
      const age = now - settledAt;
      return age >= 0 && age <= ttl;
    })
    .map((job) => {
      const failed = job.status === 'failed';
      return {
        id: `export:${job.id}:${job.status}`,
        kind: 'export' as const,
        status: failed ? 'error' as const : 'success' as const,
        label: failed
          ? t('statusBar.background.exportFailed', '{{type}} export failed', {
              type: job.type ?? '—',
            })
          : t('statusBar.background.exportReady', '{{type}} export ready', {
              type: job.type ?? '—',
            }),
        description: failed ? job.error_message || undefined : job.file_name || undefined,
        startedAt: job.completed_at ?? job.created_at ?? '',
      };
    });
}

export function useBackgroundJobs(): UseBackgroundJobsResult {
  const { t } = useTranslation();
  const { data: exportJobs } = useExportJobs({ pollWhileActive: true });
  const mutationCount = useIsMutating();
  const mutationSnapshots = useMutationState<MutationSnapshot>({
    select: (mutation) => ({
      mutationId: mutation.mutationId,
      status: mutation.state.status,
      submittedAt: mutation.state.submittedAt,
      error: mutation.state.error,
    }),
  });
  const custom = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const settledAtRef = useRef(new Map<string, number>());
  const pendingMutationIdsRef = useRef(new Set<number>());
  const exportSettledAtRef = useRef(new Map<string, number>());
  const activeExportIdsRef = useRef(new Set<string>());
  const [settlementVersion, setSettlementVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let changed = false;
    const liveKeys = new Set<string>();
    const liveMutationIds = new Set(
      mutationSnapshots.map((mutation) => mutation.mutationId),
    );
    for (const mutation of mutationSnapshots) {
      if (mutation.status === 'pending') {
        pendingMutationIdsRef.current.add(mutation.mutationId);
        continue;
      }
      if (mutation.status !== 'success' && mutation.status !== 'error') continue;
      const key = mutationSettlementKey(mutation);
      liveKeys.add(key);
      if (!settledAtRef.current.has(key)) {
        const observedAt = Date.now();
        const ttl =
          mutation.status === 'error' ? ERROR_VISIBLE_MS : SUCCESS_VISIBLE_MS;
        const wasObservedRunning = pendingMutationIdsRef.current.delete(
          mutation.mutationId,
        );
        const submittedRecently =
          mutation.submittedAt > 0 && observedAt - mutation.submittedAt <= ttl;
        settledAtRef.current.set(
          key,
          wasObservedRunning || submittedRecently ? observedAt : 0,
        );
        changed = true;
      }
    }
    for (const key of settledAtRef.current.keys()) {
      if (!liveKeys.has(key)) settledAtRef.current.delete(key);
    }
    for (const mutationId of pendingMutationIdsRef.current) {
      if (!liveMutationIds.has(mutationId)) {
        pendingMutationIdsRef.current.delete(mutationId);
      }
    }
    if (changed) setSettlementVersion((version) => version + 1);
  }, [mutationSnapshots]);

  useEffect(() => {
    let changed = false;
    let observedAt = 0;
    const liveKeys = new Set<string>();
    const currentActiveIds = new Set<string>();

    for (const job of exportJobs ?? []) {
      if (job.status === 'queued' || job.status === 'processing') {
        currentActiveIds.add(job.id);
        activeExportIdsRef.current.add(job.id);
        continue;
      }
      if (job.status !== 'ready' && job.status !== 'failed') continue;

      const key = exportSettlementKey(job);
      liveKeys.add(key);
      const wasObservedRunning = activeExportIdsRef.current.delete(job.id);
      if (exportSettledAtRef.current.has(key)) continue;

      observedAt ||= Date.now();
      const completedAt = Date.parse(job.completed_at ?? job.created_at ?? '');
      const ttl = job.status === 'failed' ? ERROR_VISIBLE_MS : SUCCESS_VISIBLE_MS;
      const completionAge = observedAt - completedAt;
      const completedRecently =
        Number.isFinite(completedAt) &&
        completionAge >= 0 &&
        completionAge <= ttl;
      const completedInFuture =
        Number.isFinite(completedAt) && completionAge < 0;
      const settledAt = completedRecently
        ? completedAt
        : wasObservedRunning &&
            (!Number.isFinite(completedAt) || completedInFuture)
          ? observedAt
          : 0;
      exportSettledAtRef.current.set(key, settledAt);
      changed = true;
    }

    for (const key of exportSettledAtRef.current.keys()) {
      if (!liveKeys.has(key)) exportSettledAtRef.current.delete(key);
    }
    for (const id of activeExportIdsRef.current) {
      if (!currentActiveIds.has(id)) activeExportIdsRef.current.delete(id);
    }

    if (changed) {
      setNow(observedAt);
      setSettlementVersion((version) => version + 1);
    }
  }, [exportJobs]);

  const hasVisibleSettledMutation = mutationSnapshots.some((mutation) => {
    if (mutation.status !== 'success' && mutation.status !== 'error') return false;
    const settledAt = settledAtRef.current.get(mutationSettlementKey(mutation));
    if (!settledAt) return false;
    const ttl = mutation.status === 'error' ? ERROR_VISIBLE_MS : SUCCESS_VISIBLE_MS;
    return now - settledAt <= ttl;
  });
  const hasVisibleSettledExport = (exportJobs ?? []).some((job) => {
    if (job.status !== 'ready' && job.status !== 'failed') return false;
    const settledAt =
      exportSettledAtRef.current.get(exportSettlementKey(job)) ?? 0;
    if (settledAt <= 0) return false;
    const ttl = job.status === 'failed' ? ERROR_VISIBLE_MS : SUCCESS_VISIBLE_MS;
    const age = now - settledAt;
    return age >= 0 && age <= ttl;
  });
  const hasSettledCandidates =
    hasVisibleSettledMutation || hasVisibleSettledExport;

  useEffect(() => {
    if (!hasSettledCandidates) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasSettledCandidates]);

  // Surface a single composite "mutation" entry rather than one row per
  // individual TanStack mutation — most users don't care WHICH save is in
  // flight, only that something is.
  const mutationJob: BackgroundJob[] = useMemo(() => {
    if (mutationCount <= 0) return [];
    return [
      {
        id: 'tanstack-mutations',
        kind: 'mutation',
        status: 'running',
        label:
          mutationCount === 1
            ? t('statusBar.background.saving', 'Saving…')
            : t('statusBar.background.savingMany', 'Saving {{count}} changes…', {
                count: mutationCount,
              }),
        startedAt: new Date().toISOString(),
      },
    ];
  }, [mutationCount, t]);

  const exports = useMemo(() => activeExportJobs(exportJobs, t), [exportJobs, t]);
  const settledExports = useMemo(
    () => recentExportJobs(exportJobs, exportSettledAtRef.current, now, t),
    [exportJobs, now, settlementVersion, t],
  );

  const settledMutation = useMemo<BackgroundJob[]>(() => {
    const recent = mutationSnapshots
      .filter(
        (mutation) => mutation.status === 'success' || mutation.status === 'error',
      )
      .map((mutation) => {
        const key = mutationSettlementKey(mutation);
        return { mutation, settledAt: settledAtRef.current.get(key) ?? 0 };
      })
      .filter(({ mutation, settledAt }) => {
        const ttl = mutation.status === 'error' ? ERROR_VISIBLE_MS : SUCCESS_VISIBLE_MS;
        return settledAt > 0 && now - settledAt <= ttl;
      })
      .sort((a, b) => {
        if (a.mutation.status !== b.mutation.status) {
          return a.mutation.status === 'error' ? -1 : 1;
        }
        return b.settledAt - a.settledAt;
      })
      .find(
        ({ mutation }) =>
          mutation.status === 'error' || mutationCount === 0,
      );

    if (!recent) return [];
    const failed = recent.mutation.status === 'error';
    return [{
      id: `tanstack-mutation:${recent.mutation.mutationId}:${recent.mutation.status}`,
      kind: 'mutation',
      status: failed ? 'error' : 'success',
      label: failed
        ? t('statusBar.background.syncFailed', 'Sync failed')
        : t('statusBar.background.saved', 'Changes saved'),
      description: failed
        ? getErrorMessage(
            recent.mutation.error,
            t('statusBar.background.tryAgain', 'Please try again'),
          )
        : undefined,
      startedAt: new Date(recent.settledAt).toISOString(),
    }];
  }, [mutationCount, mutationSnapshots, now, settlementVersion, t]);

  const jobs = useMemo(() => {
    const all = [
      ...exports,
      ...settledExports,
      ...mutationJob,
      ...settledMutation,
      ...custom,
    ];
    return all.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [custom, exports, mutationJob, settledExports, settledMutation]);

  return { jobs, hasJobs: jobs.length > 0, count: jobs.length };
}
