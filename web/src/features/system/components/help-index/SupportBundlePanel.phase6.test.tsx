import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { deriveDataState, type DataStateSource } from '@/api/dataState'
import type { UseSupportBundleResult, SupportBundleSourceState } from '@/api/hooks/useSupport'
import { buildSupportBundle, serializeSupportBundle } from '@/lib/supportBundle'
import { SupportBundlePanel } from './SupportBundlePanel'

const fixture = vi.hoisted(() => ({
  result: {} as UseSupportBundleResult,
  summary: vi.fn(),
  labels: {} as Record<string, string>,
}))

vi.mock('@/api/hooks/useSupport', () => ({ useSupportBundle: () => fixture.result }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) =>
      (fixture.labels[key] ?? fallback).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}))
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: () => 'saved-preference receipt fixture' }),
}))
vi.mock('@/components/ui', async () => {
  const { Button } = await import('@/components/ui/Button')
  const { CopyButton } = await import('@/components/ui/CopyButton')
  const { GlassPanel } = await import('@/components/ui/GlassPanel')
  const { PanelTitle, Text } = await import('@/components/ui/Typography')
  return { Button, CopyButton, GlassPanel, PanelTitle, Text }
})
vi.mock('@/components/feedback', async () => {
  const { Skeleton } = await import('@/components/feedback/Skeleton')
  return { Skeleton }
})
vi.mock('../operationalbrief-all/SystemSummaryBrief', () => ({
  SystemSummaryBrief: (props: unknown) => {
    fixture.summary(props)
    return <div data-testid="local-summary-fixture" />
  },
}))
vi.mock('@/components/feedback/ProblemReportModal', async () => {
  const { Button } = await import('@/components/ui/Button')
  return {
    ProblemReportModal: ({ onClose }: { onClose: () => void }) => (
      <div role="dialog" aria-label="Problem report fixture">
        <Button onClick={onClose}>Close fixture</Button>
      </div>
    ),
  }
})

function source(query: DataStateSource<unknown> = {}): SupportBundleSourceState {
  const { data: _data, ...state } = deriveDataState(query)
  return { ...state, isLoading: query.isLoading === true, isPending: !state.hasData && !state.fatalError, observedAt: null }
}

beforeEach(() => {
  const bundle = buildSupportBundle({
    generatedAt: '2026-10-14T07:00:00Z', appVersion: '2.0.0',
    healthOverall: 'degraded', userAgent: 'Firefox/140.0', online: true,
  })
  fixture.result = {
    bundle, json: serializeSupportBundle(bundle), filename: 'support-fixture.json',
    isLoading: false, download: vi.fn(),
    sources: {
      version: source({ data: {}, dataUpdatedAt: 1 }),
      health: source({ data: {}, dataUpdatedAt: 2 }),
    },
  }
  fixture.labels = {}
  fixture.summary.mockClear()
})

afterEach(cleanup)

describe('SupportBundlePanel phase6 partial bundle and independent sources', () => {
  it('preserves the local summary, both source fields, exclusions, exact JSON and all actions', () => {
    render(<SupportBundlePanel />)
    expect(screen.getByTestId('support-bundle-panel')).toBeVisible()
    expect(screen.getByTestId('support-bundle-never').querySelectorAll('li')).toHaveLength(5)
    expect(screen.getByTestId('support-bundle-json').textContent).toBe(fixture.result.json)
    expect(within(screen.getByTestId('support-source-version')).getByText('2.0.0')).toBeVisible()
    expect(within(screen.getByTestId('support-source-health')).getByText('degraded')).toBeVisible()
    expect(screen.getAllByText('Source observation time not supplied')).toHaveLength(2)
    expect(screen.getAllByText('Last successful response: saved-preference receipt fixture')).toHaveLength(2)
    expect(fixture.summary).toHaveBeenLastCalledWith(expect.objectContaining({
      available: true,
      metrics: [expect.objectContaining({ rawValue: 0 })],
      textMetrics: [expect.objectContaining({ key: 'browser', value: 'Firefox 140' })],
    }))
    expect(screen.getByRole('button', { name: 'Copy bundle' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeEnabled()
  })

  it('retains partial copy/download and local browser/error evidence during initial loading', async () => {
    fixture.result.isLoading = true
    fixture.result.sources.health = source({ isLoading: true, isPending: true, fetchStatus: 'fetching' })
    const user = userEvent.setup()
    render(<SupportBundlePanel />)
    expect(within(screen.getByTestId('support-source-health')).getByText('Loading')).toBeVisible()
    expect(within(screen.getByTestId('support-source-version')).getByText('2.0.0')).toBeVisible()
    expect(fixture.summary.mock.lastCall?.[0]).not.toHaveProperty('loading', true)
    expect(screen.getByRole('button', { name: 'Copy bundle' })).toBeEnabled()
    await user.click(screen.getByTestId('support-bundle-download'))
    expect(fixture.result.download).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('support-bundle-json').textContent).toBe(fixture.result.json)
  })

  it('keeps initial failure recovery source-specific without deleting the healthy neighbor or JSON', async () => {
    const retry = vi.fn()
    fixture.result.sources.health = source({ error: new Error('fixture failed'), isError: true, refetch: retry })
    const user = userEvent.setup()
    render(<SupportBundlePanel />)
    const section = screen.getByTestId('support-source-health')
    expect(within(section).getByText('Failed')).toBeVisible()
    expect(within(section).getByText('Unknown')).toBeVisible()
    await user.click(within(section).getByRole('button', { name: 'Retry Health' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(within(screen.getByTestId('support-source-version')).getByText('2.0.0')).toBeVisible()
    expect(screen.getByTestId('support-bundle-json').textContent).toBe(fixture.result.json)
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
  })

  it('shows retained values, refresh error, pause and last-success response independently', () => {
    fixture.result.sources.health = source({
      data: {}, dataUpdatedAt: 2, error: new Error('refresh fixture'), fetchStatus: 'paused',
    })
    render(<SupportBundlePanel />)
    const section = screen.getByTestId('support-source-health')
    for (const text of [
      'Cached · refresh failed', 'Refresh paused', 'degraded',
      'Source observation time not supplied',
      'Last successful response: saved-preference receipt fixture',
    ]) expect(within(section).getByText(text)).toBeVisible()
    expect(within(section).getByText('Previously loaded data remains visible while affected sources recover.')).toBeVisible()
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument()
  })

  it('labels initial pause and unknown idle without advertising readiness or inferring offline', () => {
    fixture.result.sources.version = source({ isPending: true, fetchStatus: 'idle' })
    fixture.result.sources.health = source({ isPending: true, fetchStatus: 'paused' })
    render(<SupportBundlePanel />)
    expect(within(screen.getByTestId('support-source-version')).getByText('Pending')).toBeVisible()
    expect(within(screen.getByTestId('support-source-health')).getByText('Refresh paused')).toBeVisible()
    expect(screen.getAllByText('Unknown')).toHaveLength(2)
    expect(screen.queryByText('Source available')).not.toBeInTheDocument()
    expect(screen.queryByText(/healthy|offline/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Last successful response/)).not.toBeInTheDocument()
  })

  it('keeps an unknown resolved health value unknown and disables only in-flight source retries', () => {
    fixture.result.bundle.health.overall = 'unknown'
    fixture.result.sources.version = source({ data: {}, error: new Error('fixture'), isFetching: true, refetch: vi.fn() })
    render(<SupportBundlePanel />)
    expect(within(screen.getByTestId('support-source-health')).getAllByText('Unknown')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Retry App version' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
  })

  it('adopts existing below-md 44px minima on real local hosts and retains desktop small sizing', () => {
    render(<SupportBundlePanel />)
    for (const name of ['Copy bundle', 'Download', 'Report a problem']) {
      const button = screen.getByRole('button', { name })
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveClass('max-md:min-h-11', 'max-md:min-w-11')
      expect(button).not.toHaveClass('h-11', 'min-h-11')
    }
    for (const id of ['support-bundle-download', 'open-problem-report']) {
      expect(screen.getByTestId(id)).toHaveClass('min-h-9', 'h-auto', 'whitespace-normal')
    }
    expect(screen.getByText('Show the exact bundle contents')).toHaveClass('max-md:min-h-11')
  })

  it('keeps report mounting opt-in and preserves close/reopen without a real submission', async () => {
    const user = userEvent.setup()
    render(<SupportBundlePanel />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Report a problem' }))
    expect(screen.getByRole('dialog', { name: 'Problem report fixture' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Close fixture' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Report a problem' }))
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('preserves localized long actions and source-specific retry interpolation', () => {
    fixture.labels = {
      'supportBundle.download': 'Die vollständige redigierte Diagnosezusammenfassung herunterladen',
      'supportBundle.field.health': 'Zustand der Systemdienste',
      'supportBundle.source.retry': '{{source}} erneut abfragen',
    }
    fixture.result.sources.health = source({ fetchStatus: 'paused', refetch: vi.fn() })
    render(<SupportBundlePanel />)
    expect(screen.getByRole('button', { name: fixture.labels['supportBundle.download'] })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Zustand der Systemdienste erneut abfragen' })).toBeVisible()
  })
})
