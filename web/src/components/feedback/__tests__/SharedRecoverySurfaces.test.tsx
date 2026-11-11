import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import postcss, { type Rule } from 'postcss'
import { request } from '@/api/client'
import { exportKeys, type ExportJobSummary } from '@/api/hooks/useExports'
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types'
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '../../ui/app-designs/designs'
import { ApiError } from '@/lib/resilience'
import { ErrorDisplay } from '../ErrorDisplay'
import { ErrorHelpLinks } from '../ErrorHelpLinks'
import { PermissionGuidanceNotice } from '../PermissionGuidanceNotice'
import { JobProgressDrawer } from '../JobProgressDrawer'
import OnboardingWizard from '../OnboardingWizard'

vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: vi.fn(),
}))
vi.mock('@/lib/broadcast', () => ({
  broadcast: vi.fn(),
  subscribe: () => () => {},
}))
vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''))
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

function readRules(...segments: string[]) {
  const rules: Rule[] = []
  postcss.parse(readFileSync(resolve(
    process.cwd(), 'src', 'components', 'ui', 'app-designs', ...segments,
  ), 'utf8')).walkRules(rule => { rules.push(rule) })
  return rules
}

const feedbackRules = readRules('feedback.css')
const controlRules = readRules('controls.css')
const packRules = Object.fromEntries(PACK_IDS.map(pack => [pack, readRules('packs', `${pack}.css`)]))

function matchingRules(node: Element, rules: Rule[], contract: string) {
  return rules.filter(rule => rule.selector.includes(contract)
    && [...node.ownerDocument.querySelectorAll(rule.selector)].includes(node))
}

function expectNoticeConsumer(node: Element, pack: PackId) {
  const matching = matchingRules(node, feedbackRules, '[data-app-feedback-kind="notice"]')
    .filter(rule => rule.selector.includes(`[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`))
  expect(matching.length).toBeGreaterThan(0)
  expect(matching.every(rule => rule.selector.includes(
    `[data-app-design-owner~="feedback-${APPLICATION_DESIGNS[pack].feedback}"]`,
  ))).toBe(true)
}

beforeEach(() => {
  vi.stubEnv('VITE_DOCS_BASE_URL', '')
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllEnvs()
})

describe('shared native recovery source-to-consumer contracts (not visual acceptance)', () => {
  it.each(PACK_IDS)('%s composes actual noncompact error children and preserves access navigation', pack => {
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <MemoryRouter>
          <Routes>
            <Route path="/" element={<ErrorDisplay error={new ApiError('declined', 403)} />} />
            <Route path="/help" element={<p>Help destination reached</p>} />
          </Routes>
        </MemoryRouter>
      </div>,
    )
    const host = view.container.firstElementChild!
    const release = observeAppDesignScopes(host)
    try {
      const error = screen.getByRole('alert')
      const guidance = screen.getByTestId('permission-guidance')
      expectNoticeConsumer(guidance, pack)
      expect(guidance.querySelector(':scope > [data-app-part~="feedback-icon"]')).not.toBeNull()
      expect(guidance.querySelector(':scope > [data-app-part~="feedback-content"]')).not.toBeNull()
      expect(within(guidance).getAllByRole('listitem')).toHaveLength(3)
      expect(within(guidance).getByText(/administrator of this TeslaSync install/i)).toBeInTheDocument()
      const links = within(screen.getByTestId('error-help-links')).getAllByRole('link')
      expect(links.map(link => link.getAttribute('href'))).toEqual(['/help', '/admin/audit-log', '/settings'])
      for (const link of links) {
        expectNoticeConsumer(link, pack)
        expect(matchingRules(link, controlRules, '[data-app-part~="button"]').length).toBeGreaterThan(0)
        expect(link.querySelector(':scope > [data-app-part~="feedback-content"] [data-app-part~="feedback-message"]')).not.toBeNull()
        expect(link.querySelector('button')).toBeNull()
      }
      expect(error.querySelector('[data-app-part~="feedback-footer"]')).toContainElement(guidance)
      expect(host.querySelector('[data-app-part~="metric"]')).toBeNull()
      const action = screen.getByTestId('permission-guidance-action')
      action.focus()
      expect(action).toHaveFocus()
      fireEvent.click(action)
      expect(screen.getByText('Help destination reached')).toBeInTheDocument()
    } finally {
      release()
    }
  })

  it('retains routerless anchors, configured external runbooks and compact footer suppression', () => {
    vi.stubEnv('VITE_DOCS_BASE_URL', 'https://docs.example.test')
    const view = render(<ErrorDisplay error={new ApiError('down', 500)} onRetry={vi.fn()} />)
    const links = screen.getAllByRole('link')
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/system-status', '/help', 'https://docs.example.test/docs/runbooks/phase-44-debug-from-trace.md',
    ])
    const runbook = links[2]
    expect(runbook).toHaveAttribute('target', '_blank')
    expect(runbook).toHaveAttribute('rel', 'noopener noreferrer')
    expect(runbook).toHaveAttribute('data-app-feedback-kind', 'notice')
    expect(runbook).toHaveAttribute('data-app-part', 'feedback button')
    expect(runbook.querySelector('[data-app-part~="feedback-message"]')).toHaveTextContent(/trace IDs/i)
    const retry = vi.fn()
    view.rerender(<ErrorDisplay error={new ApiError('down', 500)} onRetry={retry} compact />)
    expect(screen.queryByTestId('error-help-links')).toBeNull()
    expect(view.container.querySelector('[data-app-part~="feedback-footer"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })

  it('uses the nearest complete profile and leaves neutral/incomplete trees unowned', () => {
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes('blueprint')}>
        <PermissionGuidanceNotice kind="forbidden" />
        <div data-app-design-preview="" {...getAppDesignAttributes('warm')}>
          <ErrorHelpLinks kind="network" />
        </div>
        <div data-app-design-preview="" data-app-design-pack="blueprint" data-testid="incomplete">
          <PermissionGuidanceNotice kind="read_only" />
        </div>
        <div data-app-design-preview="" data-testid="neutral">
          <PermissionGuidanceNotice kind="open_mode" compact />
        </div>
      </div>,
    )
    const host = view.container.firstElementChild!
    const release = observeAppDesignScopes(host)
    try {
      const nestedLink = within(screen.getByTestId('error-help-links')).getAllByRole('link')[0]
      expectNoticeConsumer(nestedLink, 'warm')
      expect(nestedLink.getAttribute('data-app-design-owner')).toContain('pack-warm')
      for (const id of ['incomplete', 'neutral']) {
        const notice = within(screen.getByTestId(id)).getByRole('status')
        expect(notice).not.toHaveAttribute('data-app-design-owner')
        expect(matchingRules(notice, feedbackRules, '[data-app-feedback-kind="notice"]')).toHaveLength(0)
        expect(notice).toHaveClass('bg-[var(--surface-1)]', 'rounded-panel')
      }
    } finally {
      release()
    }
  })

  it.each(PACK_IDS)('%s adopts the real wizard without replacing its modal or step extents', pack => {
    const onClose = vi.fn()
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <OnboardingWizard open onClose={onClose} />
      </div>,
    )
    const release = observeAppDesignScopes(view.container.firstElementChild!)
    try {
      const dialog = screen.getByRole('dialog')
      expect(dialog.parentElement).toHaveAttribute('data-app-part', 'overlay')
      expect(dialog.parentElement).toHaveClass('top-12', 'lg:top-0')
      expect(matchingRules(dialog, packRules[pack], '[data-app-part~="dialog"]').length).toBeGreaterThan(0)
      for (const slot of ['header', 'body', 'footer']) {
        const node = dialog.querySelector(`:scope > [data-app-part~="dialog-${slot}"]`)!
        expect(node).not.toBeNull()
        expect(matchingRules(node, packRules[pack], `[data-app-part~="dialog-${slot}"]`).length).toBeGreaterThan(0)
      }
      expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
      for (let step = 1; step <= 4; step++) {
        const progress = screen.getByRole('group', { name: `Step ${step} of 4` })
        expect(progress.children).toHaveLength(4)
        expect(progress.querySelectorAll('.w-6')).toHaveLength(1)
        expect(progress.children[step - 1]).toHaveClass('w-6')
        expect(onClose).not.toHaveBeenCalled()
        fireEvent.click(screen.getByRole('button', { name: step === 4 ? 'Get Started' : 'Next' }))
      }
      expect(onClose).toHaveBeenCalledOnce()
      expect(dialog.querySelector('[data-app-part~="metric"]')).toBeNull()
    } finally {
      release()
    }
  })

  it('keeps actual export records, byte distinctions, source order and ready-only native downloads', async () => {
    const jobs: ExportJobSummary[] = [
      { id: 'queued', type: 'drives', format: 'Custom format', status: 'queued', created_at: '2026-01-01T00:00:00Z' },
      { id: 'zero', type: 'charging', format: 'csv', status: 'ready', file_size: 0, created_at: '2026-01-01T00:00:00Z' },
      { id: 'missing', type: 'backup', format: 'json', status: 'ready', created_at: '2026-01-01T00:00:00Z' },
      { id: 'failed', type: 'analytics', format: 'csv', status: 'failed', error_message: 'Preserved source diagnostic', created_at: '2026-01-01T00:00:00Z' },
    ]
    vi.mocked(request).mockResolvedValue(jobs)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    client.setQueryData(exportKeys.jobs, jobs)
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes('blueprint')}>
        <QueryClientProvider client={client}>
          <MemoryRouter><JobProgressDrawer /></MemoryRouter>
        </QueryClientProvider>
      </div>,
    )
    const release = observeAppDesignScopes(view.container.firstElementChild!)
    try {
      fireEvent.click(screen.getByRole('button', { name: /Show export jobs/i }))
      const drawer = await screen.findByRole('region', { name: 'Export job progress' })
      const records = drawer.querySelectorAll('[data-app-list="export-jobs"] > [data-app-record-kind="export-job"]')
      expect(records).toHaveLength(4)
      expect([...records].map(row => row.getAttribute('data-app-job-status'))).toEqual(['queued', 'ready', 'ready', 'failed'])
      expect([...records].map(row => row.querySelector('[data-app-part~="job-label"]')?.textContent)).toEqual(['Drives', 'Charging', 'Backup', 'Analytics'])
      expect(records[0]).toHaveAttribute('data-app-job-bucket', 'active')
      expect(records[0].querySelector('[data-app-part~="job-format"]')).toHaveTextContent('Custom format')
      expect(records[1].querySelector('[data-app-part~="job-context"]')).toHaveTextContent(/^0 B · /)
      expect(records[2].querySelector('[data-app-part~="job-context"]')).toHaveTextContent(/^— · /)
      expect(records[3].querySelector('[data-app-part~="job-error"]')).toHaveTextContent('Preserved source diagnostic')
      expect(records[3].querySelector('[data-app-part~="job-error"]')).toHaveClass('text-[var(--semantic-danger)]')
      expect(drawer.querySelector('[data-app-part~="badge"]')).toHaveTextContent('1 active')
      const downloads = within(drawer).getAllByRole('link', { name: /Download .* export/ })
      expect(downloads.map(link => link.getAttribute('href'))).toEqual([
        '/api/v1/export/jobs/zero/download', '/api/v1/export/jobs/missing/download',
      ])
      await waitFor(() => expect(downloads[0]).toHaveAttribute('data-app-design-owner'))
      for (const link of downloads) {
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noreferrer')
        expect(link).toHaveAttribute('data-app-variant', 'outline')
        expect(matchingRules(link, controlRules, '[data-app-part~="button"]').length).toBeGreaterThan(0)
      }
      expect(drawer.querySelector('[data-app-part~="metric"], [role="progressbar"]')).toBeNull()
      fireEvent.click(within(drawer).getByRole('button', { name: 'Minimize' }))
      expect(screen.getByRole('button', { name: /Show export jobs/i })).toBeInTheDocument()
      expect(localStorage.getItem('teslasync.exportDrawer.state')).toBe('minimized')
    } finally {
      release()
      client.clear()
    }
  })
})
