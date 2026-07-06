/**
 * export — wire types + runtime backbone for the data-export job aggregate.
 *
 * {@link ExportJob} mirrors the backend `dto.ExportJobResponse` /
 * `domain/export.ExportJob` shape returned by `GET /exports/{id}` and
 * `GET /export/jobs` (camelCase JSON tags: `vehicleId`, `fsmState`, `filePath`,
 * `fileSize`, `failedReason`, `createdAt`, `completedAt`). The Go side tags the
 * optional fields `omitempty`, so they are *absent* — never `null` — when unset;
 * `request()`'s `camelCaseKeys()` transform then exposes the camelCase reads.
 *
 * The module also owns the job's runtime lifecycle contract: the canonical
 * FSM-state vocabulary (single source of truth mirroring
 * `internal/domain/export/fsm.go`), a shape guard for validating an untrusted
 * response at the fetch boundary, and the coarse UI-status classifier the
 * dashboard export widget renders its badges from.
 */

// ── Backend FSM-state vocabulary (mirror of internal/domain/export/fsm.go) ─────

/**
 * Every state the backend export FSM can occupy, in lifecycle order. Single
 * source of truth: a state added to / removed from
 * `internal/domain/export/fsm.go` must be reflected here (the contract test
 * pins the exact set and order).
 */
export const EXPORT_JOB_FSM_STATES = [
  'queued',
  'validating',
  'processing',
  'uploading',
  'completed',
  'failed',
] as const;

/** Union of the six backend export FSM states. */
export type ExportJobFsmState = (typeof EXPORT_JOB_FSM_STATES)[number];

/** Narrows an untrusted value to a known {@link ExportJobFsmState}. */
export function isExportJobFsmState(value: unknown): value is ExportJobFsmState {
  return (
    typeof value === 'string' &&
    (EXPORT_JOB_FSM_STATES as readonly string[]).includes(value)
  );
}

// ── Wire shape ────────────────────────────────────────────────────────────────

/**
 * A data-export job as returned by `GET /exports/{id}` and `GET /export/jobs`.
 *
 * `fsmState` carries the raw backend FSM state — one of
 * {@link EXPORT_JOB_FSM_STATES}. It stays typed as `string` (not the narrow
 * union) for wire-faithfulness, so a future/stale server state can never become
 * a compile error on the client; narrow it with {@link isExportJobFsmState} or
 * collapse it to a coarse badge with {@link exportJobStatus}.
 */
export interface ExportJob {
  id: string;
  format: string;
  vehicleId: string;
  fsmState: string;
  filePath?: string;
  fileSize?: number;
  failedReason?: string;
  createdAt: string;
  completedAt?: string;
}

// ── Coarse UI status ────────────────────────────────────────────────────────

/**
 * The coarse, presentation-facing buckets the dashboard collapses the six FSM
 * states into — one badge per value. `'ready'` is the UI label for the terminal
 * `'completed'` FSM state.
 */
export const EXPORT_JOB_STATUSES = ['queued', 'processing', 'ready', 'failed'] as const;

/** Union of the four coarse UI statuses. */
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

/**
 * Collapses an {@link ExportJob}'s `fsmState` into a coarse
 * {@link ExportJobStatus}. Null-safe and case-insensitive: a missing, empty, or
 * unrecognised state buckets to `'queued'` so the UI never renders a blank badge.
 *
 * Mapping (canonical FSM states first, tolerated legacy aliases second):
 * ```
 *   queued, validating              → 'queued'
 *   processing, uploading, running  → 'processing'
 *   completed, ready, done          → 'ready'
 *   failed, error                   → 'failed'
 * ```
 */
export function exportJobStatus(
  job: Pick<ExportJob, 'fsmState'> | null | undefined,
): ExportJobStatus {
  switch ((job?.fsmState ?? '').toLowerCase()) {
    case 'processing':
    case 'uploading':
    case 'running':
      return 'processing';
    case 'completed':
    case 'ready':
    case 'done':
      return 'ready';
    case 'failed':
    case 'error':
      return 'failed';
    default:
      // queued, validating, '', and any unknown/stale state.
      return 'queued';
  }
}

/** True while the job is still pending or actively producing its artifact. */
export function isExportJobActive(job: Pick<ExportJob, 'fsmState'> | null | undefined): boolean {
  const status = exportJobStatus(job);
  return status === 'queued' || status === 'processing';
}

/** True once the job has finished successfully and its artifact is downloadable. */
export function isExportJobComplete(job: Pick<ExportJob, 'fsmState'> | null | undefined): boolean {
  return exportJobStatus(job) === 'ready';
}

/** True once the job has terminally failed. */
export function isExportJobFailed(job: Pick<ExportJob, 'fsmState'> | null | undefined): boolean {
  return exportJobStatus(job) === 'failed';
}

// ── Shape guard ───────────────────────────────────────────────────────────────

/**
 * Validates that an untrusted value is structurally an {@link ExportJob}: the
 * five required string fields are present and every optional field, when
 * present, has the correct primitive type. Intended for the fetch boundary
 * before a `/exports/{id}` payload is trusted.
 */
export function isExportJob(value: unknown): value is ExportJob {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const j = value as Record<string, unknown>;
  if (typeof j.id !== 'string') return false;
  if (typeof j.format !== 'string') return false;
  if (typeof j.vehicleId !== 'string') return false;
  if (typeof j.fsmState !== 'string') return false;
  if (typeof j.createdAt !== 'string') return false;
  if (j.filePath !== undefined && typeof j.filePath !== 'string') return false;
  if (j.fileSize !== undefined && typeof j.fileSize !== 'number') return false;
  if (j.failedReason !== undefined && typeof j.failedReason !== 'string') return false;
  if (j.completedAt !== undefined && typeof j.completedAt !== 'string') return false;
  return true;
}
