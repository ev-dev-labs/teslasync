/**
 * FeedbackExpansion — per-row drawer body for the Admin feedback queue.
 *
 * The component is presentational + locally-stateful: it renders one
 * FeedbackEntry (report body, redacted metadata grid, optional error/console
 * disclosures), the deterministic manual triage controls (Status Select,
 * GitHub URL Input, Save URL button, Forward-to-GitHub button), and mounts the
 * propose-only AI advisor. Its sole export is `FeedbackExpansion`; the internal
 * `ExpandField` layout helper is covered transitively via the metadata grid.
 *
 * Coverage:
 *   1. Body + metadata — every ExpandField label/value + the masked email.
 *   2. Empty/null-safety — blank body & metadata collapse to an em-dash and the
 *      email cell shows a dash (no MaskedValue) rather than crashing.
 *   3. Submitter falls back to submitter_ip when submitter_subject is blank.
 *   4/5. Optional error + console disclosures render when present, absent when
 *      empty/null.
 *   6. Status Select change calls onUpdate with the chosen status.
 *   7. `updating` disables every write control.
 *   8. Save URL is gated until the field diverges from the persisted value,
 *      then calls onUpdate with the typed URL.
 *   9. Forward-to-GitHub shows only when the bridge is enabled AND no URL is
 *      persisted; clicking it calls onUpdate with forward_to_github.
 *   10/11. Persisted-URL sync regression — the field re-syncs when the server
 *      value changes, but an in-progress edit survives an unrelated re-render.
 *   12. Email is masked by default and reveals on the a11y-labelled toggle,
 *      never leaking the cleartext before reveal.
 *   13. The AI advisor is always mounted with the in-scope row id.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ComponentProps, ReactNode } from 'react'

// Deterministic i18n: `t(key, default)` returns the default string, so
// assertions read the shipped English defaults without depending on the
// translation catalogue being loaded in jsdom.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// The AI advisor is a separately-gated feature with its own SSE wiring +
// off-mode invariant tests. Stub it so this unit test stays hermetic and only
// asserts FeedbackExpansion's own contract: the advisor is always mounted and
// receives the in-scope row id (propose-only coexistence).
vi.mock('@/components/ai/AIFeedbackQueueTriage', () => ({
  AIFeedbackQueueTriage: ({ feedbackId }: { feedbackId?: number }) => (
    <div data-testid="ai-advisor" data-feedback-id={String(feedbackId ?? '')} />
  ),
}))

import { FeedbackExpansion } from './FeedbackExpansion'
import type { FeedbackEntry } from '@/api/types'

const EM_DASH = '\u2014'
const isEmDash = (content: string) => content === EM_DASH

type OnUpdate = ComponentProps<typeof FeedbackExpansion>['onUpdate']

function makeRow(over: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    id: 7,
    created_at: '2024-01-15T12:00:00Z',
    category: 'bug',
    title: 'Drive timeline is missing the last 30 minutes',
    body: 'After arriving home the timeline cuts off ~30 minutes early.',
    page_route: '/drives',
    user_agent: 'Mozilla/5.0 (TestAgent)',
    app_version: '1.2.3',
    user_email: 'reporter@example.com',
    recent_errors: null,
    console_tail: '',
    status: 'new',
    github_issue_url: '',
    submitter_subject: 'user-7',
    submitter_ip: '',
    triaged_at: null,
    triaged_by: '',
    ...over,
  }
}

function renderExpansion(
  opts: { row?: FeedbackEntry; bridgeEnabled?: boolean; updating?: boolean } = {},
) {
  const onUpdate = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = (o: typeof opts) => (
    <QueryClientProvider client={qc}>
      <FeedbackExpansion
        row={o.row ?? makeRow()}
        bridgeEnabled={o.bridgeEnabled ?? false}
        onUpdate={onUpdate as unknown as OnUpdate}
        updating={o.updating ?? false}
      />
    </QueryClientProvider>
  )
  const view = render(tree(opts))
  const rerenderWith = (next: typeof opts) => view.rerender(tree(next))
  return { onUpdate, rerenderWith, ...view }
}

beforeEach(() => {
  // MaskedValue's auditOnReveal fires a fire-and-forget POST; stub fetch so no
  // real network attempt (and no unhandled rejection) escapes the test.
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FeedbackExpansion', () => {
  it('renders the report body and every metadata field', () => {
    renderExpansion({ row: makeRow() })

    expect(screen.getByText('Report body')).toBeInTheDocument()
    expect(
      screen.getByText('After arriving home the timeline cuts off ~30 minutes early.'),
    ).toBeInTheDocument()

    // ExpandField labels + values across the metadata grid.
    expect(screen.getByText('App version')).toBeInTheDocument()
    expect(screen.getByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByText('User agent')).toBeInTheDocument()
    expect(screen.getByText('Mozilla/5.0 (TestAgent)')).toBeInTheDocument()
    expect(screen.getByText('Submitter')).toBeInTheDocument()
    expect(screen.getByText('user-7')).toBeInTheDocument()
    expect(screen.getByText('Email')).toBeInTheDocument()

    // The email renders through the MaskedValue privacy primitive.
    expect(screen.getByTestId('masked-value')).toBeInTheDocument()
  })

  it('collapses blank body and metadata to em-dashes and hides the mask (null-safety)', () => {
    renderExpansion({
      row: makeRow({
        body: '',
        app_version: '',
        user_agent: '',
        submitter_subject: '',
        submitter_ip: '',
        user_email: '',
      }),
    })

    // body '' + app_version '' + user_agent '' + submitter '' + email '' → five
    // em-dash placeholders, none of which crash the render.
    expect(screen.getAllByText(isEmDash)).toHaveLength(5)
    // Blank email must NOT mount the reveal affordance.
    expect(screen.queryByTestId('masked-value')).not.toBeInTheDocument()
  })

  it('falls back to submitter_ip when submitter_subject is blank', () => {
    renderExpansion({
      row: makeRow({ submitter_subject: '', submitter_ip: '203.0.113.9' }),
    })

    expect(screen.getByText('203.0.113.9')).toBeInTheDocument()
  })

  it('renders the recent-errors disclosure with pretty-printed JSON only when present', () => {
    const { rerenderWith } = renderExpansion({
      row: makeRow({ recent_errors: { count: 2, messages: ['boom', 'kapow'] } }),
    })

    expect(screen.getByText('Recent frontend errors')).toBeInTheDocument()
    expect(screen.getByText(/"count": 2/)).toBeInTheDocument()
    expect(screen.getByText(/"boom"/)).toBeInTheDocument()

    // Null recent_errors hides the disclosure entirely.
    rerenderWith({ row: makeRow({ recent_errors: null }) })
    expect(screen.queryByText('Recent frontend errors')).not.toBeInTheDocument()
  })

  it('renders the console-tail disclosure only when non-empty', () => {
    const { rerenderWith } = renderExpansion({
      row: makeRow({ console_tail: 'ERROR boot failed\nWARN retrying' }),
    })

    expect(screen.getByText('Console tail')).toBeInTheDocument()
    expect(screen.getByText(/ERROR boot failed/)).toBeInTheDocument()

    rerenderWith({ row: makeRow({ console_tail: '' }) })
    expect(screen.queryByText('Console tail')).not.toBeInTheDocument()
  })

  it('calls onUpdate with the chosen status when the Status select changes', () => {
    const { onUpdate } = renderExpansion({ row: makeRow({ status: 'new' }) })

    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'triaged' },
    })

    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({
      id: 7,
      update: { status: 'triaged' },
    })
  })

  it('disables every write control while a mutation is in flight', () => {
    // bridge enabled + no URL so the Forward button is present to assert on.
    renderExpansion({
      row: makeRow({ github_issue_url: '' }),
      bridgeEnabled: true,
      updating: true,
    })

    expect(screen.getByLabelText('Status')).toBeDisabled()
    expect(screen.getByLabelText('GitHub issue URL')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save URL' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Forward to GitHub' }),
    ).toBeDisabled()
  })

  it('gates Save URL until the field diverges, then calls onUpdate with the typed URL', () => {
    const { onUpdate } = renderExpansion({ row: makeRow({ github_issue_url: '' }) })

    const input = screen.getByLabelText('GitHub issue URL') as HTMLInputElement
    const save = screen.getByRole('button', { name: 'Save URL' })

    // Initially the draft equals the persisted value (''), so Save is disabled.
    expect(save).toBeDisabled()

    fireEvent.change(input, {
      target: { value: 'https://github.com/o/r/issues/9' },
    })
    expect(input.value).toBe('https://github.com/o/r/issues/9')
    expect(save).toBeEnabled()

    fireEvent.click(save)
    expect(onUpdate).toHaveBeenCalledWith({
      id: 7,
      update: { github_issue_url: 'https://github.com/o/r/issues/9' },
    })
  })

  it('shows Forward to GitHub only when the bridge is enabled and no URL is persisted', () => {
    // Hidden when the bridge is disabled.
    const { rerenderWith, onUpdate } = renderExpansion({
      row: makeRow({ github_issue_url: '' }),
      bridgeEnabled: false,
    })
    expect(
      screen.queryByRole('button', { name: 'Forward to GitHub' }),
    ).not.toBeInTheDocument()

    // Hidden when a URL is already persisted, even with the bridge on.
    rerenderWith({
      row: makeRow({ github_issue_url: 'https://github.com/o/r/issues/1' }),
      bridgeEnabled: true,
    })
    expect(
      screen.queryByRole('button', { name: 'Forward to GitHub' }),
    ).not.toBeInTheDocument()

    // Shown when the bridge is on and no URL is persisted.
    rerenderWith({ row: makeRow({ github_issue_url: '' }), bridgeEnabled: true })
    const forward = screen.getByRole('button', { name: 'Forward to GitHub' })
    expect(forward).toBeInTheDocument()

    fireEvent.click(forward)
    expect(onUpdate).toHaveBeenCalledWith({
      id: 7,
      update: { forward_to_github: true },
    })
  })

  it('re-syncs the URL field when the server-persisted value changes (regression)', () => {
    // Start with a null persisted URL to exercise the `?? ''` coalescing path.
    const { rerenderWith } = renderExpansion({
      row: makeRow({ github_issue_url: null as unknown as string }),
    })

    const input = screen.getByLabelText('GitHub issue URL') as HTMLInputElement
    expect(input.value).toBe('')

    fireEvent.change(input, { target: { value: 'https://typed-but-unsaved' } })
    expect(input.value).toBe('https://typed-but-unsaved')

    // A mutation round-trip re-renders the row with a server-persisted URL: the
    // field must reset to it, and Save must become disabled (draft === persisted).
    rerenderWith({
      row: makeRow({ github_issue_url: 'https://github.com/o/r/issues/42' }),
    })
    expect(input.value).toBe('https://github.com/o/r/issues/42')
    expect(screen.getByRole('button', { name: 'Save URL' })).toBeDisabled()
  })

  it('preserves an in-progress edit across an unrelated re-render', () => {
    const { rerenderWith } = renderExpansion({
      row: makeRow({ github_issue_url: '' }),
      bridgeEnabled: false,
    })

    const input = screen.getByLabelText('GitHub issue URL') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'https://still-editing' } })
    expect(input.value).toBe('https://still-editing')

    // An unrelated prop change (bridge toggles) must NOT clobber the draft,
    // because the persisted URL is unchanged.
    rerenderWith({ row: makeRow({ github_issue_url: '' }), bridgeEnabled: true })
    expect(input.value).toBe('https://still-editing')
  })

  it('masks the email by default and reveals it via the accessible toggle', () => {
    renderExpansion({ row: makeRow({ user_email: 'reporter@example.com' }) })

    // Before reveal the cleartext must not appear anywhere in the DOM.
    expect(screen.queryByText('reporter@example.com')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Reveal value' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(toggle)

    expect(screen.getByText('reporter@example.com')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Hide value' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('always mounts the propose-only AI advisor with the in-scope row id', () => {
    renderExpansion({ row: makeRow({ id: 99 }) })

    const advisor = screen.getByTestId('ai-advisor')
    expect(advisor).toBeInTheDocument()
    expect(advisor).toHaveAttribute('data-feedback-id', '99')
  })
})
