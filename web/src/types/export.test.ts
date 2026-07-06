/**
 * export — contract tests for the data-export job wire type + runtime backbone.
 *
 * The module used to be *type-only* (the `ExportJob` interface erased at
 * runtime). It now also owns the job's runtime lifecycle contract, so —
 * following the repo convention for type modules (see
 * types/admin-diagnostics.test.ts and
 * features/charging/components/charging-curve/types.test.ts) — this suite locks
 * the contract on two levels:
 *
 *   • Runtime (`expect`)      — `EXPORT_JOB_FSM_STATES` mirrors the Go FSM
 *     (`internal/domain/export/fsm.go`) exactly; `isExportJobFsmState` /
 *     `isExportJob` accept every valid member and reject foreign + malformed
 *     input without peeking into containers; `exportJobStatus` maps ALL six FSM
 *     states (plus tolerated legacy aliases) into the four UI buckets — this is
 *     the logic the dashboard export widget now renders from, so the regression
 *     that bucketed `uploading` / `validating` as "queued" is pinned here.
 *   • Compile-time (`expectTypeOf`) — each union equals its documented literal
 *     set AND is derived from its const tuple; the wire interface keeps
 *     `fsmState: string` and the correct optional-field types. Runtime no-ops
 *     enforced by `tsc` / vitest typecheck.
 *
 * No network, no DOM — pure structural + guard assertions, so no MSW/Query harness.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';

import {
  EXPORT_JOB_FSM_STATES,
  EXPORT_JOB_STATUSES,
  isExportJobFsmState,
  exportJobStatus,
  isExportJobActive,
  isExportJobComplete,
  isExportJobFailed,
  isExportJob,
} from './export';
import type { ExportJob, ExportJobFsmState, ExportJobStatus } from './export';

// Every non-string value a string-literal guard must reject. Includes an array
// whose element is a valid member and an object that "looks like" a job — the
// guard must reject the container, never inspect inside it.
const NON_STRINGS: unknown[] = [
  null,
  undefined,
  0,
  1,
  NaN,
  Infinity,
  true,
  false,
  {},
  [],
  ['queued'],
  { fsmState: 'queued' },
];

/** A fully-populated, structurally-valid job (all optionals present). */
const VALID_FULL: Record<string, unknown> = {
  id: 'exp_1',
  format: 'csv',
  vehicleId: 'veh_1',
  fsmState: 'completed',
  filePath: '/exports/exp_1.csv',
  fileSize: 2048,
  failedReason: 'none',
  createdAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T00:05:00Z',
};

/** The minimal valid job — only the five required fields. */
const VALID_MINIMAL: Record<string, unknown> = {
  id: 'exp_2',
  format: 'json',
  vehicleId: 'veh_2',
  fsmState: 'queued',
  createdAt: '2026-01-02T00:00:00Z',
};

const REQUIRED_FIELDS = ['id', 'format', 'vehicleId', 'fsmState', 'createdAt'] as const;

// ── EXPORT_JOB_FSM_STATES — single source of truth for the Go FSM ─────────────

describe('EXPORT_JOB_FSM_STATES', () => {
  it('mirrors internal/domain/export/fsm.go exactly, in lifecycle order', () => {
    expect(EXPORT_JOB_FSM_STATES).toEqual([
      'queued',
      'validating',
      'processing',
      'uploading',
      'completed',
      'failed',
    ]);
  });

  it('has no duplicate members (a dup would silently shrink the union)', () => {
    expect(new Set(EXPORT_JOB_FSM_STATES).size).toBe(EXPORT_JOB_FSM_STATES.length);
  });

  it('is the single source of truth for the ExportJobFsmState union', () => {
    expectTypeOf<(typeof EXPORT_JOB_FSM_STATES)[number]>().toEqualTypeOf<ExportJobFsmState>();
    expectTypeOf<ExportJobFsmState>().toEqualTypeOf<
      'queued' | 'validating' | 'processing' | 'uploading' | 'completed' | 'failed'
    >();
    // Runtime companion: the first tuple member round-trips through the guard.
    expect(isExportJobFsmState(EXPORT_JOB_FSM_STATES[0])).toBe(true);
  });
});

// ── isExportJobFsmState ───────────────────────────────────────────────────────

describe('isExportJobFsmState', () => {
  it('accepts every documented FSM state', () => {
    expect(EXPORT_JOB_FSM_STATES.length).toBe(6);
    for (const state of EXPORT_JOB_FSM_STATES) {
      expect(isExportJobFsmState(state), `rejected valid state ${state}`).toBe(true);
    }
  });

  it('rejects UI-only aliases that are NOT backend FSM states', () => {
    // 'ready' / 'done' / 'running' / 'error' are display aliases the classifier
    // tolerates but the backend FSM never emits — the guard must reject them.
    for (const alias of ['ready', 'done', 'running', 'error', 'QUEUED', 'Completed', '']) {
      expect(isExportJobFsmState(alias), `accepted foreign value ${alias}`).toBe(false);
    }
  });

  it('rejects every non-string input without peeking into containers', () => {
    for (const value of NON_STRINGS) {
      expect(isExportJobFsmState(value)).toBe(false);
    }
  });

  it('narrows an untrusted value to ExportJobFsmState inside the branch', () => {
    const raw: unknown = 'processing';
    if (!isExportJobFsmState(raw)) throw new Error('guard should have accepted "processing"');
    expectTypeOf(raw).toEqualTypeOf<ExportJobFsmState>();
    expect(EXPORT_JOB_FSM_STATES).toContain(raw);
  });
});

// ── ExportJob — the wire shape ────────────────────────────────────────────────

describe('ExportJob wire shape', () => {
  it('accepts a fully-populated job assignable without a cast', () => {
    const job: ExportJob = {
      id: 'exp_1',
      format: 'csv',
      vehicleId: 'veh_1',
      fsmState: 'completed',
      filePath: '/exports/exp_1.csv',
      fileSize: 2048,
      failedReason: 'none',
      createdAt: '2026-01-01T00:00:00Z',
      completedAt: '2026-01-01T00:05:00Z',
    };

    expect(Object.keys(job).sort()).toEqual([
      'completedAt',
      'createdAt',
      'failedReason',
      'filePath',
      'fileSize',
      'format',
      'fsmState',
      'id',
      'vehicleId',
    ]);
    expect(job.fileSize).toBe(2048);
    expect(job.fsmState).toBe('completed');
  });

  it('accepts a minimal job (required fields only) with optionals absent', () => {
    const job: ExportJob = {
      id: 'exp_2',
      format: 'json',
      vehicleId: 'veh_2',
      fsmState: 'queued',
      createdAt: '2026-01-02T00:00:00Z',
    };

    expect(job.filePath).toBeUndefined();
    expect(job.fileSize).toBeUndefined();
    expect(job.completedAt).toBeUndefined();
    expect(job.id).toBe('exp_2');
  });

  it('keeps fsmState wire-faithful as string and locks optional field types', () => {
    // Intentionally `string`, not the narrow union — a stale/future server state
    // must not be a compile error on the client.
    expectTypeOf<ExportJob['fsmState']>().toEqualTypeOf<string>();
    expectTypeOf<ExportJob['id']>().toEqualTypeOf<string>();
    expectTypeOf<ExportJob['fileSize']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ExportJob['filePath']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ExportJob['completedAt']>().toEqualTypeOf<string | undefined>();
  });
});

// ── EXPORT_JOB_STATUSES + ExportJobStatus ─────────────────────────────────────

describe('EXPORT_JOB_STATUSES', () => {
  it('is exactly the four UI badge buckets', () => {
    expect(EXPORT_JOB_STATUSES).toEqual(['queued', 'processing', 'ready', 'failed']);
    expect(new Set(EXPORT_JOB_STATUSES).size).toBe(4);
  });

  it('drives the ExportJobStatus union', () => {
    expectTypeOf<(typeof EXPORT_JOB_STATUSES)[number]>().toEqualTypeOf<ExportJobStatus>();
    expectTypeOf<ExportJobStatus>().toEqualTypeOf<'queued' | 'processing' | 'ready' | 'failed'>();
  });
});

// ── exportJobStatus — the classifier the widget renders from ───────────────────

describe('exportJobStatus', () => {
  const TABLE: ReadonlyArray<readonly [string, ExportJobStatus]> = [
    // Canonical backend FSM states.
    ['queued', 'queued'],
    ['validating', 'queued'],
    ['processing', 'processing'],
    ['uploading', 'processing'],
    ['completed', 'ready'],
    ['failed', 'failed'],
    // Tolerated legacy / display aliases.
    ['running', 'processing'],
    ['done', 'ready'],
    ['ready', 'ready'],
    ['error', 'failed'],
  ];

  it('maps every FSM state + legacy alias to the right UI bucket', () => {
    for (const [state, expected] of TABLE) {
      expect(exportJobStatus({ fsmState: state }), `${state} -> ${expected}`).toBe(expected);
    }
  });

  it('fixes the regression: uploading/validating no longer collapse to queued', () => {
    // The old widget helper fell through to 'queued' for these active states.
    expect(exportJobStatus({ fsmState: 'uploading' })).toBe('processing');
    expect(exportJobStatus({ fsmState: 'validating' })).toBe('queued');
    // Guard against the specific regression value.
    expect(exportJobStatus({ fsmState: 'uploading' })).not.toBe('queued');
  });

  it('is case-insensitive', () => {
    expect(exportJobStatus({ fsmState: 'COMPLETED' })).toBe('ready');
    expect(exportJobStatus({ fsmState: 'Processing' })).toBe('processing');
    expect(exportJobStatus({ fsmState: 'FAILED' })).toBe('failed');
  });

  it('buckets missing / empty / unknown state to queued (never a blank badge)', () => {
    expect(exportJobStatus(null)).toBe('queued');
    expect(exportJobStatus(undefined)).toBe('queued');
    expect(exportJobStatus({ fsmState: '' })).toBe('queued');
    expect(exportJobStatus({ fsmState: 'totally-unknown-state' })).toBe('queued');
  });

  it('is total over the FSM: every state yields a valid UI status', () => {
    for (const state of EXPORT_JOB_FSM_STATES) {
      expect(EXPORT_JOB_STATUSES).toContain(exportJobStatus({ fsmState: state }));
    }
    expectTypeOf(exportJobStatus({ fsmState: 'queued' })).toEqualTypeOf<ExportJobStatus>();
  });
});

// ── isExportJobActive / Complete / Failed — the status predicates ─────────────

describe('export job status predicates', () => {
  it('partition every FSM state into exactly one of active / complete / failed', () => {
    for (const state of EXPORT_JOB_FSM_STATES) {
      const job = { fsmState: state };
      const flags = [isExportJobActive(job), isExportJobComplete(job), isExportJobFailed(job)];
      expect(flags.filter(Boolean), `state ${state} matched multiple predicates`).toHaveLength(1);
    }
  });

  it('agree with exportJobStatus buckets', () => {
    expect(isExportJobActive({ fsmState: 'queued' })).toBe(true);
    expect(isExportJobActive({ fsmState: 'uploading' })).toBe(true);
    expect(isExportJobActive({ fsmState: 'completed' })).toBe(false);
    expect(isExportJobComplete({ fsmState: 'completed' })).toBe(true);
    expect(isExportJobComplete({ fsmState: 'processing' })).toBe(false);
    expect(isExportJobFailed({ fsmState: 'failed' })).toBe(true);
    expect(isExportJobFailed({ fsmState: 'queued' })).toBe(false);
  });

  it('are null-safe: a missing job is treated as still-active (queued)', () => {
    expect(isExportJobActive(null)).toBe(true);
    expect(isExportJobActive(undefined)).toBe(true);
    expect(isExportJobComplete(null)).toBe(false);
    expect(isExportJobFailed(undefined)).toBe(false);
  });
});

// ── isExportJob — the fetch-boundary shape guard ──────────────────────────────

describe('isExportJob', () => {
  it('accepts a fully-populated and a minimal valid job', () => {
    expect(isExportJob(VALID_FULL)).toBe(true);
    expect(isExportJob(VALID_MINIMAL)).toBe(true);
  });

  it('rejects a job missing any required field', () => {
    for (const field of REQUIRED_FIELDS) {
      const bad = { ...VALID_FULL };
      delete bad[field];
      expect(isExportJob(bad), `missing ${field} should be rejected`).toBe(false);
    }
  });

  it('rejects a wrong primitive type on a required field', () => {
    expect(isExportJob({ ...VALID_MINIMAL, id: 123 })).toBe(false);
    expect(isExportJob({ ...VALID_MINIMAL, fsmState: null })).toBe(false);
    expect(isExportJob({ ...VALID_MINIMAL, createdAt: 0 })).toBe(false);
  });

  it('rejects a wrong primitive type on an optional field', () => {
    expect(isExportJob({ ...VALID_MINIMAL, fileSize: '2048' })).toBe(false);
    expect(isExportJob({ ...VALID_MINIMAL, filePath: 5 })).toBe(false);
    expect(isExportJob({ ...VALID_MINIMAL, failedReason: true })).toBe(false);
    expect(isExportJob({ ...VALID_MINIMAL, completedAt: 0 })).toBe(false);
  });

  it('accepts optionals when present with the correct type', () => {
    expect(
      isExportJob({
        ...VALID_MINIMAL,
        filePath: '/x.csv',
        fileSize: 10,
        failedReason: 'boom',
        completedAt: '2026-01-02T00:05:00Z',
      }),
    ).toBe(true);
  });

  it('rejects null, primitives, and arrays (including an array of valid jobs)', () => {
    for (const value of [null, undefined, 0, 'exp', true, [], [VALID_FULL]]) {
      expect(isExportJob(value)).toBe(false);
    }
  });

  it('narrows an untrusted payload to ExportJob inside the branch', () => {
    const raw: unknown = VALID_FULL;
    if (!isExportJob(raw)) throw new Error('guard should have accepted VALID_FULL');
    expectTypeOf(raw).toEqualTypeOf<ExportJob>();
    expect(raw.id).toBe('exp_1');
    expect(raw.fileSize).toBe(2048);
  });
});
