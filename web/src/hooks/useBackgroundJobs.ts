import { useMemo, useSyncExternalStore } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useExportJobs, type ExportJobSummary } from '@/api/hooks/useExports';

/**
 * useBackgroundJobs — .
 *
 * Single source of truth for "is there work happening in the background?"
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

export interface BackgroundJob {
  /** Stable id used for de-duplication. */
  id: string;
  /** Human-readable title shown in the popover (already i18n'd by the caller). */
  label: string;
  /** What kind of work this is — drives the icon shown in the popover. */
  kind: BackgroundJobKind;
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
export function registerJob(input: Omit<BackgroundJob, 'startedAt' | 'kind'> & { kind?: BackgroundJobKind }): () => void {
  // Spread the caller's input FIRST, then apply defaults last. Doing it the
  // other way round let an explicit `kind: undefined` on `input` clobber the
  // `?? 'custom'` fallback back to `undefined`, which then crashed the footer
  // popover's icon lookup (`KIND_ICON[undefined]`).
  const job: BackgroundJob = {
    ...input,
    kind: input.kind ?? 'custom',
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
  /** Combined list of in-flight jobs (export + mutation + custom). */
  jobs: BackgroundJob[];
  /** Convenience flag — true iff `jobs.length > 0`. */
  hasJobs: boolean;
  /** How many jobs are running (cheap re-render guard for badges). */
  count: number;
}

function activeExportJobs(jobs: ExportJobSummary[] | undefined, t: TFunction): BackgroundJob[] {
  if (!jobs) return [];
  return jobs
    .filter((j) => j.status === 'queued' || j.status === 'processing')
    .map<BackgroundJob>((j) => ({
      id: `export:${j.id}`,
      kind: 'export',
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

export function useBackgroundJobs(): UseBackgroundJobsResult {
  const { t } = useTranslation();
  const { data: exportJobs } = useExportJobs({ pollWhileActive: true });
  const mutationCount = useIsMutating();
  const custom = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Surface a single composite "mutation" entry rather than one row per
  // individual TanStack mutation — most users don't care WHICH save is in
  // flight, only that something is.
  const mutationJob: BackgroundJob[] = useMemo(() => {
    if (mutationCount <= 0) return [];
    return [
      {
        id: 'tanstack-mutations',
        kind: 'mutation',
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

  const jobs = useMemo(() => {
    const all = [...exports, ...mutationJob, ...custom];
    return all.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [exports, mutationJob, custom]);

  return { jobs, hasJobs: jobs.length > 0, count: jobs.length };
}
