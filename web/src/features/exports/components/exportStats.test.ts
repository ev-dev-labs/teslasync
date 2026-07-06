// Behavioural contract for the exports-page derivation module.
//
// exportStats.ts is the single tested home for the status metadata and
// aggregation logic every section of the Exports page reads from (KPI band,
// status breakdown, jobs-table status badge). These tests pin the facets that
// matter: the canonical STATUS_ORDER sequence + its self-consistent colour
// map, the status→<Badge> variant derivation (so status stays legible without
// colour alone), and — the crux — that deriveExportStats aggregates a single
// pass correctly, honours its "Always null-safe" docstring on
// null/undefined/hole-laden input, never emits NaN from a malformed
// file_size, and can't have a counter corrupted by a prototype-colliding
// status string.
//
// Pure module: no DOM, no providers, no network. exportStats.ts imports only
// types (erased at compile time), so the unit under test is dependency-free.

import { describe, it, expect } from 'vitest';

import {
  STATUS_ORDER,
  statusColor,
  statusBadgeVariant,
  deriveExportStats,
  type ExportStats,
} from './exportStats';
import type { ExportJobSummary } from '@/api/hooks/useExports';

const ALL_STATUSES: ExportJobSummary['status'][] = [
  'ready',
  'processing',
  'queued',
  'failed',
  'expired',
];

function makeJob(overrides: Partial<ExportJobSummary> = {}): ExportJobSummary {
  return {
    id: 'job-1',
    type: 'drives',
    format: 'csv',
    status: 'ready',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('STATUS_ORDER', () => {
  it('lists every job status exactly once, ready-first through terminal', () => {
    // The KPI band, breakdown and any status-keyed iteration all render in
    // this exact sequence — order is part of the contract, not incidental.
    expect(STATUS_ORDER).toEqual([
      'ready',
      'processing',
      'queued',
      'failed',
      'expired',
    ]);
  });

  it('covers the full ExportJobSummary status union with no duplicates', () => {
    expect(new Set(STATUS_ORDER).size).toBe(STATUS_ORDER.length);
    expect([...STATUS_ORDER].sort()).toEqual([...ALL_STATUSES].sort());
  });
});

describe('statusColor', () => {
  it('maps every ordered status onto a 6-digit hex colour', () => {
    // MetricBar/status dots take a raw CSS colour string, so each entry must
    // be a literal hex — a token class or an undefined lookup would break the
    // dynamic gradient MetricBar composes from it.
    for (const status of STATUS_ORDER) {
      expect(statusColor[status]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keys exactly the STATUS_ORDER statuses (no missing / stray colours)', () => {
    expect(Object.keys(statusColor).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it('pins the semantic anchors: ready is green, failed is rose', () => {
    expect(statusColor.ready).toBe('#10b981');
    expect(statusColor.failed).toBe('#f43f5e');
  });
});

describe('statusBadgeVariant', () => {
  it('derives the canonical Badge variant for each status branch', () => {
    expect(statusBadgeVariant('ready')).toBe('success');
    expect(statusBadgeVariant('failed')).toBe('danger');
    expect(statusBadgeVariant('processing')).toBe('info');
    expect(statusBadgeVariant('queued')).toBe('info');
    // `expired` falls through the switch to the neutral default.
    expect(statusBadgeVariant('expired')).toBe('neutral');
  });

  it('only ever returns a real <Badge> variant for known statuses', () => {
    const allowed = new Set(['info', 'success', 'warning', 'danger', 'neutral']);
    for (const status of STATUS_ORDER) {
      expect(allowed.has(statusBadgeVariant(status))).toBe(true);
    }
  });
});

describe('deriveExportStats', () => {
  it('returns a fully-zeroed, all-keyed shape for an empty array', () => {
    const stats: ExportStats = deriveExportStats([]);
    expect(stats.total).toBe(0);
    expect(stats.ready).toBe(0);
    expect(stats.inProgress).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.expired).toBe(0);
    expect(stats.totalBytes).toBe(0);
    // byStatus is always keyed for all statuses so consumers can index it
    // without a guard even when nothing has that status yet.
    expect(stats.byStatus).toEqual({
      ready: 0,
      processing: 0,
      queued: 0,
      failed: 0,
      expired: 0,
    });
  });

  it('honours its "Always null-safe" contract on null / undefined input', () => {
    // Callers are typed to pass an array, but a runtime null/undefined must
    // not throw on `for…of` / `.length` — that would take the page down.
    expect(() => deriveExportStats(null)).not.toThrow();
    expect(() => deriveExportStats(undefined)).not.toThrow();
    expect(deriveExportStats(null).total).toBe(0);
    expect(deriveExportStats(undefined).totalBytes).toBe(0);
    expect(deriveExportStats(null).byStatus.ready).toBe(0);
  });

  it('is null-safe against holes inside the jobs array', () => {
    const withHoles = [
      makeJob({ status: 'ready', file_size: 100 }),
      null,
      undefined,
      makeJob({ status: 'failed' }),
    ] as unknown as ExportJobSummary[];

    const stats = deriveExportStats(withHoles);

    // Holes are dropped from both the pass and the total.
    expect(stats.total).toBe(2);
    expect(stats.ready).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.totalBytes).toBe(100);
  });

  it('aggregates counts, the in-progress bucket and storage in one pass', () => {
    const jobs = [
      makeJob({ id: 'a', status: 'ready', file_size: 1_000 }),
      makeJob({ id: 'b', status: 'processing', file_size: 500 }),
      makeJob({ id: 'c', status: 'queued', file_size: 250 }),
      makeJob({ id: 'd', status: 'failed', file_size: 0 }),
      makeJob({ id: 'e', status: 'expired', file_size: 42 }),
      makeJob({ id: 'f', status: 'ready', file_size: 8 }),
    ];

    const stats = deriveExportStats(jobs);

    expect(stats.total).toBe(6);
    expect(stats.ready).toBe(2);
    // inProgress is the processing + queued bucket surfaced as one KPI.
    expect(stats.inProgress).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.totalBytes).toBe(1_800);
    expect(stats.byStatus).toEqual({
      ready: 2,
      processing: 1,
      queued: 1,
      failed: 1,
      expired: 1,
    });
  });

  it('treats a missing file_size as zero bytes without going NaN', () => {
    const stats = deriveExportStats([
      makeJob({ status: 'ready' }), // file_size omitted
      makeJob({ status: 'ready', file_size: 320 }),
    ]);
    expect(stats.ready).toBe(2);
    expect(stats.totalBytes).toBe(320);
    expect(Number.isNaN(stats.totalBytes)).toBe(false);
  });

  it('ignores non-finite and negative file_size so the storage KPI stays sane', () => {
    // A single malformed row (NaN / Infinity / negative) must not poison the
    // whole storage total — the docstring guarantees totalBytes is never NaN.
    const jobs = [
      makeJob({ id: 'a', status: 'ready', file_size: Number.NaN }),
      makeJob({ id: 'b', status: 'ready', file_size: Number.POSITIVE_INFINITY }),
      makeJob({ id: 'c', status: 'ready', file_size: -1_000 }),
      makeJob({ id: 'd', status: 'ready', file_size: 2_048 }),
    ];

    const stats = deriveExportStats(jobs);

    expect(stats.total).toBe(4);
    expect(stats.totalBytes).toBe(2_048);
    expect(Number.isFinite(stats.totalBytes)).toBe(true);
  });

  it('counts an unrecognised status in the total but in no known bucket', () => {
    // A status the backend adds that the frontend hasn't learned yet still
    // counts toward "Total Exports" but must not be silently bucketed.
    const jobs = [
      makeJob({ status: 'ready' }),
      makeJob({ status: 'archived' as ExportJobSummary['status'] }),
    ];

    const stats = deriveExportStats(jobs);

    expect(stats.total).toBe(2);
    expect(stats.ready).toBe(1);
    expect(stats.byStatus).toEqual({
      ready: 1,
      processing: 0,
      queued: 0,
      failed: 0,
      expired: 0,
    });
  });

  it('cannot have a counter corrupted by a prototype-colliding status', () => {
    // With the naive `status in byStatus` check, a "toString" status would
    // resolve to Object.prototype.toString and increment a function slot,
    // turning that counter into NaN. The own-key guard keeps every counter a
    // real number.
    const jobs = [
      makeJob({ status: 'toString' as ExportJobSummary['status'] }),
      makeJob({ status: 'hasOwnProperty' as ExportJobSummary['status'] }),
      makeJob({ status: 'ready' }),
    ];

    const stats = deriveExportStats(jobs);

    expect(stats.total).toBe(3);
    expect(stats.ready).toBe(1);
    expect(Number.isNaN(stats.byStatus.ready)).toBe(false);
    // Every emitted bucket value is a finite number, never a coerced function.
    for (const status of STATUS_ORDER) {
      expect(Number.isFinite(stats.byStatus[status])).toBe(true);
    }
  });
});
