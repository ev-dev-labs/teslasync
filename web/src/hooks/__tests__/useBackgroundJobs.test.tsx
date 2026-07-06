/**
 * useBackgroundJobs behaviour tests.
 *
 * Exercises the module-scoped custom-job registry plus the aggregation hook
 * that feeds the footer status bar's BackgroundWorkSegment. Covers every
 * runtime export (registerJob, __clearBackgroundJobsForTests, useBackgroundJobs)
 * across:
 *   - registerJob: default kind, explicit kind, the `kind: undefined`
 *     spread-order regression, the disposer removing only its own entry, and
 *     idempotent re-registration by id
 *   - __clearBackgroundJobsForTests draining every custom registration
 *   - export aggregation: queued/processing filtering, file_name vs
 *     "<type> export" label fallback, Queued/Processing description, and
 *     undefined / malformed payload null-safety
 *   - the composite TanStack-mutation row (singular, plural, none)
 *   - combined export + mutation + custom aggregation sorted oldest-first
 *
 * The three data sources are stubbed so the hook runs without a QueryClient,
 * a Router, or real network — mirroring the mock-the-dependency convention
 * used by useTitleBadge.test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ExportJobSummary } from '@/api/hooks/useExports'

// --- useExportJobs: the hook only reads `.data`, so a minimal stub is enough.
let mockExportData: ExportJobSummary[] | undefined = []
vi.mock('@/api/hooks/useExports', () => ({
  useExportJobs: () => ({ data: mockExportData }),
}))

// --- useIsMutating: return a deterministic count so no QueryClientProvider
//     is required. Everything else in react-query is preserved.
let mockMutating = 0
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useIsMutating: () => mockMutating }
})

// --- react-i18next: a stable translator that returns the inline English
//     default and interpolates {{token}} placeholders like i18next would.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const t = (_key: string, def: string, opts?: Record<string, unknown>) =>
    opts
      ? Object.entries(opts).reduce(
          (out, [k, v]) => out.replace(new RegExp(`{{${k}}}`, 'g'), String(v)),
          def,
        )
      : def
  return { ...actual, useTranslation: () => ({ t }) }
})

import {
  useBackgroundJobs,
  registerJob,
  __clearBackgroundJobsForTests,
} from '../useBackgroundJobs'

function exportJob(over: Partial<ExportJobSummary> = {}): ExportJobSummary {
  return {
    id: '1',
    type: 'drives',
    format: 'csv',
    status: 'queued',
    created_at: '2024-01-01T00:00:00.000Z',
    ...over,
  }
}

beforeEach(() => {
  mockExportData = []
  mockMutating = 0
  act(() => {
    __clearBackgroundJobsForTests()
  })
})

afterEach(() => {
  act(() => {
    __clearBackgroundJobsForTests()
  })
})

describe('registerJob + custom store', () => {
  it('registers a custom job, defaulting kind to "custom" and stamping a valid startedAt', () => {
    const { result } = renderHook(() => useBackgroundJobs())
    act(() => {
      registerJob({ id: 'backup', label: 'Generating backup' })
    })

    expect(result.current.count).toBe(1)
    const job = result.current.jobs[0]
    expect(job.id).toBe('backup')
    expect(job.label).toBe('Generating backup')
    expect(job.kind).toBe('custom')
    expect(Number.isNaN(Date.parse(job.startedAt))).toBe(false)
  })

  it('honours an explicit kind override', () => {
    const { result } = renderHook(() => useBackgroundJobs())
    act(() => {
      registerJob({ id: 'x', label: 'Exporting', kind: 'export' })
    })
    expect(result.current.jobs[0].kind).toBe('export')
  })

  it('falls back to "custom" when kind is explicitly undefined (spread-order regression)', () => {
    const { result } = renderHook(() => useBackgroundJobs())
    act(() => {
      registerJob({ id: 'y', label: 'Job', kind: undefined })
    })
    // Before the fix, `...input` overwrote the `?? 'custom'` default with the
    // explicit `undefined`, which crashed the popover's `KIND_ICON[undefined]`.
    expect(result.current.jobs[0].kind).toBe('custom')
  })

  it('returns a disposer that removes only its own registration', () => {
    const { result } = renderHook(() => useBackgroundJobs())
    let disposeA: () => void = () => {}
    act(() => {
      disposeA = registerJob({ id: 'a', label: 'A' })
      registerJob({ id: 'b', label: 'B' })
    })
    expect(result.current.count).toBe(2)

    act(() => disposeA())
    expect(result.current.count).toBe(1)
    expect(result.current.jobs[0].id).toBe('b')
  })

  it('replaces an existing registration with the same id (idempotent, latest wins)', () => {
    const { result } = renderHook(() => useBackgroundJobs())
    act(() => {
      registerJob({ id: 'dup', label: 'First' })
      registerJob({ id: 'dup', label: 'Second' })
    })
    expect(result.current.count).toBe(1)
    expect(result.current.jobs[0].label).toBe('Second')
  })

  it('__clearBackgroundJobsForTests drains every custom registration', () => {
    const { result } = renderHook(() => useBackgroundJobs())
    act(() => {
      registerJob({ id: 'a', label: 'A' })
      registerJob({ id: 'b', label: 'B' })
    })
    expect(result.current.count).toBe(2)

    act(() => __clearBackgroundJobsForTests())
    expect(result.current.count).toBe(0)
    expect(result.current.hasJobs).toBe(false)
  })
})

describe('useBackgroundJobs — aggregation', () => {
  it('reports no work when there are no exports, mutations, or custom jobs', () => {
    const { result } = renderHook(() => useBackgroundJobs())
    expect(result.current.jobs).toEqual([])
    expect(result.current.hasJobs).toBe(false)
    expect(result.current.count).toBe(0)
  })

  it('tolerates undefined export data without throwing', () => {
    mockExportData = undefined
    const { result } = renderHook(() => useBackgroundJobs())
    expect(result.current.count).toBe(0)
    expect(result.current.jobs).toEqual([])
  })

  it('surfaces only queued/processing export jobs, ignoring settled ones', () => {
    mockExportData = [
      exportJob({ id: '1', status: 'queued', created_at: '2024-01-01T00:00:00.000Z' }),
      exportJob({ id: '2', status: 'processing', created_at: '2024-01-02T00:00:00.000Z' }),
      exportJob({ id: '3', status: 'ready' }),
      exportJob({ id: '4', status: 'failed' }),
      exportJob({ id: '5', status: 'expired' }),
    ]
    const { result } = renderHook(() => useBackgroundJobs())

    expect(result.current.count).toBe(2)
    expect(result.current.jobs.map((j) => j.id)).toEqual(['export:1', 'export:2'])
    expect(result.current.jobs.every((j) => j.kind === 'export')).toBe(true)
  })

  it('labels export jobs by file_name, falling back to "<type> export"', () => {
    mockExportData = [
      exportJob({ id: '1', file_name: 'drives-2024.csv', created_at: '2024-01-01T00:00:00.000Z' }),
      exportJob({ id: '2', file_name: undefined, type: 'charging', created_at: '2024-01-02T00:00:00.000Z' }),
    ]
    const { result } = renderHook(() => useBackgroundJobs())

    expect(result.current.jobs[0].label).toBe('drives-2024.csv')
    expect(result.current.jobs[1].label).toBe('charging export')
  })

  it('sets the export description to Queued/Processing from status', () => {
    mockExportData = [
      exportJob({ id: '1', status: 'queued', created_at: '2024-01-01T00:00:00.000Z' }),
      exportJob({ id: '2', status: 'processing', created_at: '2024-01-02T00:00:00.000Z' }),
    ]
    const { result } = renderHook(() => useBackgroundJobs())

    expect(result.current.jobs[0].description).toBe('Queued')
    expect(result.current.jobs[1].description).toBe('Processing')
  })

  it('adds a single composite mutation row labelled "Saving…" for one in-flight mutation', () => {
    mockMutating = 1
    const { result } = renderHook(() => useBackgroundJobs())

    expect(result.current.count).toBe(1)
    const job = result.current.jobs[0]
    expect(job.id).toBe('tanstack-mutations')
    expect(job.kind).toBe('mutation')
    expect(job.label).toBe('Saving…')
  })

  it('pluralises the mutation label with the count for multiple mutations', () => {
    mockMutating = 3
    const { result } = renderHook(() => useBackgroundJobs())
    expect(result.current.jobs[0].label).toBe('Saving 3 changes…')
  })

  it('emits no mutation row when nothing is mutating', () => {
    mockMutating = 0
    const { result } = renderHook(() => useBackgroundJobs())
    expect(result.current.jobs.some((j) => j.kind === 'mutation')).toBe(false)
  })

  it('aggregates export + mutation + custom jobs, sorted oldest-first', () => {
    mockExportData = [exportJob({ id: '1', status: 'queued', created_at: '2020-01-01T00:00:00.000Z' })]
    mockMutating = 2
    const { result } = renderHook(() => useBackgroundJobs())
    act(() => {
      registerJob({ id: 'c', label: 'Custom' })
    })

    expect(result.current.count).toBe(3)
    expect(result.current.hasJobs).toBe(true)
    // The export's created_at is in 2020; the mutation + custom rows are
    // stamped "now", so the export sorts to the front.
    expect(result.current.jobs[0].id).toBe('export:1')
    expect(result.current.jobs.map((j) => j.kind).sort()).toEqual(['custom', 'export', 'mutation'])
  })

  it('does not crash the sort when an export job is missing created_at', () => {
    mockExportData = [
      { id: '1', type: 'drives', format: 'csv', status: 'queued' } as unknown as ExportJobSummary,
    ]
    mockMutating = 1
    const { result } = renderHook(() => useBackgroundJobs())

    expect(result.current.count).toBe(2)
    // The malformed export's startedAt fell back to '' and sorts first.
    expect(result.current.jobs[0].id).toBe('export:1')
  })
})
