import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types'
import { getAppDesignAttributes } from '@/components/ui/app-designs/designs'
import { previewProblemReport, type ProblemReportInput } from '@/lib/problemReport'
import { buildSupportBundle, type SupportBundle } from '@/lib/supportBundle'
import { expectAppDesignDataMode, matchingAppDesignDataRules } from './appDesignCss.test-utils'
import { ProblemReportModal } from './ProblemReportModal'

const mutation = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  mutateAsync: vi.fn<(input: ProblemReportInput) => Promise<void>>(),
}))
let bundle: SupportBundle

vi.mock('@/api/hooks/useSupport', () => ({
  useSupportBundle: () => ({ bundle }),
  useSubmitProblemReport: () => mutation,
}))

beforeEach(() => {
  bundle = buildSupportBundle({
    generatedAt: '2026-11-10T00:00:00Z',
    appVersion: '2.0.0',
    userAgent: 'Firefox/140.0',
    healthOverall: 'unknown',
    errors: [{ name: 'SourceError', message: 'Fixture source unavailable', route: '/drives/12345' }],
  })
  mutation.isPending = false
  mutation.isError = false
  mutation.mutateAsync.mockReset()
})
afterEach(cleanup)

function reportInput(includeDiagnostics = false): ProblemReportInput {
  return {
    title: '',
    description: '',
    pathname: '/drives/12345',
    includeDiagnostics,
    bundle,
    appVersion: bundle.app.version,
    browserSummary: `${bundle.browser.family} ${bundle.browser.major_version}`.trim(),
  }
}

describe('ProblemReportModal source-owned context and exact payload', () => {
  it.each(PACK_IDS)('opens real %s portal surfaces without changing consent or the preview bytes', async packId => {
    render(<MemoryRouter initialEntries={['/drives/12345']}>
      <div data-app-design-preview="" {...getAppDesignAttributes(packId)}>
        <ProblemReportModal open onClose={vi.fn()} />
      </div>
    </MemoryRouter>)
    expect(screen.getByRole('dialog', { name: 'Report a problem' })).toHaveAttribute('aria-modal', 'true')
    const context = screen.getByTestId('attachment-policy').closest('[data-app-part~="card"]')
    if (!context) throw new Error('Missing report context surface')
    expect(context).toHaveAttribute('data-surface-variant', 'standalone')
    expect(context.getAttribute('data-app-design-owner')).toContain(`pack-${packId}`)
    const identitySelectors: string[] = []
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', `${packId}.css`), 'utf8'))
      .walkRules(rule => {
        identitySelectors.push(...rule.selectors.filter(selector => selector.includes('[data-app-part~="card"]')))
      })
    expect(identitySelectors.some(selector => context.matches(selector))).toBe(true)
    expect(screen.getByTestId('attachment-policy').querySelectorAll('li')).toHaveLength(4)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('problem-report-route')).toHaveTextContent('/drives/:id')
    expect(screen.queryByTestId('problem-report-preview')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('problem-report-preview-toggle'))
    const preview = screen.getByTestId('problem-report-preview')
    expect(preview.tagName).toBe('PRE')
    expect(preview).toHaveAttribute('data-app-part', 'panel')
    expect(preview).toHaveAttribute('data-app-panel-kind', 'code')
    expect(preview).toHaveAttribute('data-surface-variant', 'standalone')
    await waitFor(() => expect(preview.getAttribute('data-app-design-owner')).toContain(`pack-${packId}`))
    expectAppDesignDataMode(preview, context.closest('[data-app-data]')?.getAttribute('data-app-data') ?? '',
      '[data-app-panel-kind="code"]')
    expect(preview.textContent).toBe(previewProblemReport(reportInput()))
    expect(JSON.parse(preview.textContent ?? '{}')).not.toHaveProperty('recent_errors')
    expect(preview).toHaveClass('max-h-64', 'overflow-auto')
    expect(mutation.mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('problem-report-preview-toggle'))
    expect(screen.queryByTestId('problem-report-preview')).not.toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('keeps diagnostic inclusion explicit and clears consent, inputs and preview on close', () => {
    const onClose = vi.fn()
    const modal = (open: boolean) => <MemoryRouter initialEntries={['/drives/12345']}>
      <ProblemReportModal open={open} onClose={onClose} />
    </MemoryRouter>
    const { rerender } = render(modal(false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(modal(true))
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByTestId('problem-report-preview-toggle'))
    const preview = screen.getByTestId('problem-report-preview')
    expect(preview.textContent).toBe(previewProblemReport(reportInput(true)))
    expect(JSON.parse(preview.textContent ?? '{}')).toHaveProperty('recent_errors.health_overall', 'unknown')
    expect(preview).not.toHaveAttribute('data-app-design-owner')
    expect(matchingAppDesignDataRules(preview, '[data-app-panel-kind="code"]')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: 'Fixture export failed' } })
    rerender(modal(false))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(modal(true))
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByLabelText(/What went wrong\?/)).toHaveValue('')
    expect(screen.queryByTestId('problem-report-preview')).not.toBeInTheDocument()
    expect(mutation.mutateAsync).not.toHaveBeenCalled()
  })

  it('preserves pending and failed submission controls while keeping context and exact preview readable', () => {
    const onClose = vi.fn()
    const modal = () => <MemoryRouter initialEntries={['/drives/12345']}>
      <ProblemReportModal open onClose={onClose} />
    </MemoryRouter>
    const { rerender } = render(modal())
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: 'Fixture export failed' } })
    fireEvent.change(screen.getByLabelText(/What were you doing, and what did you expect\?/), {
      target: { value: 'The completed drive export remains blank after opening its panel.' },
    })
    fireEvent.click(screen.getByTestId('problem-report-preview-toggle'))
    const exactPreview = screen.getByTestId('problem-report-preview').textContent
    mutation.isPending = true
    rerender(modal())
    expect(screen.getByTestId('problem-report-submit')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.submit(screen.getByTestId('problem-report-form'))
    expect(mutation.mutateAsync).not.toHaveBeenCalled()
    mutation.isPending = false
    mutation.isError = true
    rerender(modal())
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByTestId('problem-report-submit')).toBeEnabled()
    expect(screen.getByTestId('problem-report-preview').textContent).toBe(exactPreview)
    expect(screen.getByTestId('attachment-policy')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it.each([false, true])('submits only on request with diagnostics consent %s and the exact reviewed input', async includeDiagnostics => {
    const onClose = vi.fn()
    mutation.mutateAsync.mockResolvedValue()
    render(<MemoryRouter initialEntries={['/drives/12345']}>
      <ProblemReportModal open onClose={onClose} />
    </MemoryRouter>)
    const input = {
      ...reportInput(includeDiagnostics),
      title: 'Fixture export failed',
      description: 'The completed drive export remains blank after opening its panel.',
    }
    fireEvent.change(screen.getByRole('textbox', { name: /What went wrong\?/ }), { target: { value: input.title } })
    fireEvent.change(screen.getByRole('textbox', { name: /What were you doing/ }), { target: { value: input.description } })
    if (includeDiagnostics) fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByTestId('problem-report-preview-toggle'))
    expect(screen.getByTestId('problem-report-preview').textContent).toBe(previewProblemReport(input))
    expect(mutation.mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('problem-report-submit'))
    await waitFor(() => expect(mutation.mutateAsync).toHaveBeenCalledExactlyOnceWith(input))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
