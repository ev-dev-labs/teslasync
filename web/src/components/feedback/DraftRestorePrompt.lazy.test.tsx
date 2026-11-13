import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from '@/components/ui/Input'
import type { DraftEntry } from '@/lib/draftIndex'

const { reported } = vi.hoisted(() => ({ reported: vi.fn() }))
vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: reported }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, value?: unknown, extra?: Record<string, unknown>) => {
      const options = typeof value === 'string' ? extra : value as Record<string, unknown> | undefined
      let text = typeof value === 'string' ? value : String(options?.defaultValue ?? key)
      for (const [name, replacement] of Object.entries(options ?? {})) {
        text = text.replace(`{{${name}}}`, String(replacement))
      }
      return text
    },
  }),
}))

type ContentModule = typeof import('./DraftRestoreReviewContent')
let Prompt: typeof import('./DraftRestorePrompt')['DraftRestorePrompt']
let index: typeof import('@/lib/draftIndex')
let bus: typeof import('@/lib/broadcast')
let getAttributes: typeof import('../ui/app-designs/designs')['getAppDesignAttributes']
let observeScopes: typeof import('../ui/app-designs/designs')['observeAppDesignScopes']
let resolveModule: (module: ContentModule) => void
let rejectModule: (error: Error) => void
let load: ReturnType<typeof vi.fn<() => Promise<ContentModule>>>
const releases: Array<() => void> = []
const fixtures: HTMLElement[] = []
const firstKey = 'teslasync:draft:v1:alertstudio:rule:42'
const secondKey = 'teslasync:draft:v1:automation:new'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  sessionStorage.clear()
  reported.mockClear()
  const pending = new Promise<ContentModule>((resolve, reject) => {
    resolveModule = resolve
    rejectModule = reject
  })
  load = vi.fn(() => pending)
  vi.doMock('@/components/feedback/DraftRestoreReviewContent', load)
  const designs = await import('../ui/app-designs/designs')
  getAttributes = designs.getAppDesignAttributes
  observeScopes = designs.observeAppDesignScopes
  index = await import('@/lib/draftIndex')
  bus = await import('@/lib/broadcast')
  Prompt = (await import('./DraftRestorePrompt')).DraftRestorePrompt
})

afterEach(() => {
  cleanup()
  for (const release of releases.splice(0)) release()
  for (const fixture of fixtures.splice(0)) fixture.remove()
  for (const name of Object.keys(getAttributes('classic'))) document.documentElement.removeAttribute(name)
  bus.__resetBroadcastForTests()
  vi.doUnmock('@/components/feedback/DraftRestoreReviewContent')
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

function draft(storageKey = firstKey, savedAt = Date.now() - 60_000, label = 'Private alert draft') {
  const entry: DraftEntry = {
    storageKey, savedAt, label, version: 1,
    key: storageKey === firstKey ? 'alertstudio:rule:42' : 'automation:new',
    route: storageKey === firstKey ? '/alert-studio?id=42' : '/automations/new',
  }
  localStorage.setItem(storageKey, JSON.stringify({ version: 1, savedAt, value: { text: 'Do not lose this draft' } }))
  index.registerDraft(entry)
  return entry
}

function mount(kind: 'complete' | 'incomplete' | 'default' = 'complete') {
  const fixture = document.createElement('section')
  const locale = document.createElement('section')
  locale.setAttribute('dir', 'rtl')
  locale.setAttribute('lang', 'ar')
  const preview = document.createElement('section')
  if (kind !== 'default') {
    preview.setAttribute('data-app-design-preview', '')
    for (const [name, value] of Object.entries(getAttributes('editorial'))) preview.setAttribute(name, value)
    if (kind === 'incomplete') preview.removeAttribute('data-app-controls')
  }
  const other = document.createElement('section')
  other.setAttribute('data-app-design-preview', '')
  other.setAttribute('dir', 'ltr')
  other.setAttribute('lang', 'en')
  for (const [name, value] of Object.entries(getAttributes('bauhaus'))) other.setAttribute(name, value)
  locale.append(preview)
  fixture.append(locale, other)
  document.body.append(fixture)
  fixtures.push(fixture)
  releases.push(observeScopes(document.documentElement))
  let location = ''
  function LocationProbe() {
    const current = useLocation()
    location = current.pathname + current.search
    return null
  }
  const view = render(
    <MemoryRouter>
      <Input label="Background draft" defaultValue="Still editing" />
      <Prompt gracePeriodMs={1} skipSessionGuard />
      <LocationProbe />
    </MemoryRouter>,
    { container: preview },
  )
  return { ...view, preview, locale, other, getLocation: () => location }
}

async function review() {
  const button = await screen.findByTestId('draft-restore-prompt-review')
  button.focus()
  fireEvent.click(button)
  await waitFor(() => expect(load).toHaveBeenCalledOnce())
  return screen.getByRole('dialog', { name: 'Restore unsaved drafts' })
}

async function finishLoading(visible = true) {
  await act(async () => {
    const module = await vi.importActual<ContentModule>('./DraftRestoreReviewContent')
    resolveModule(module)
    await vi.dynamicImportSettled()
  })
  if (visible) await screen.findByTestId('draft-restore-modal-list')
}

describe('on-demand draft Review body', () => {
  it('keeps recovery/banner eager without loading Review code or disturbing a mounted draft', async () => {
    draft()
    mount()
    await screen.findByTestId('draft-restore-prompt')
    expect(load).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Background draft' }), { target: { value: 'New unsent changes' } })
    fireEvent.click(screen.getByTestId('draft-restore-prompt-dismiss'))
    expect(load).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Background draft' })).toHaveValue('New unsent changes')
    expect(localStorage.getItem(firstKey)).toContain('Do not lose this draft')
    expect(sessionStorage.getItem('teslasync:draft-prompt-shown:v1')).toBe('1')
  })

  it.each(['escape', 'close'] as const)('uses the original usable Modal while pending and cancels with %s', async method => {
    draft()
    mount()
    const dialog = await review()
    expect(within(dialog).getByRole('status')).toHaveTextContent('Loading')
    expect(dialog.querySelector('[data-modal-scroll-body]')).toHaveClass('min-h-0', 'overflow-y-auto')
    const close = within(dialog).getByRole('button', { name: 'Close', exact: true })
    await waitFor(() => expect(close).toHaveFocus())
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    fireEvent(close, tab)
    expect(tab.defaultPrevented).toBe(true)
    if (method === 'escape') fireEvent.keyDown(close, { key: 'Escape' })
    else fireEvent.click(close)
    await finishLoading(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(localStorage.getItem(firstKey)).not.toBeNull()
    expect(sessionStorage.getItem('teslasync:draft-prompt-shown:v1')).toBe('1')
  })

  it.each(['detached', 'reparented'] as const)('retains the Review invocation profile and locale when %s before body loading', async mutation => {
    draft()
    const { preview, other } = mount()
    const dialog = await review()
    if (mutation === 'detached') preview.remove()
    else other.append(preview)
    await finishLoading()
    const portal = dialog.closest('[data-app-design-portal]')
    expect(portal).toHaveAttribute('data-app-design-pack', 'editorial')
    expect(portal).toHaveAttribute('dir', 'rtl')
    expect(portal).toHaveAttribute('lang', 'ar')
  })

  it.each(['default', 'incomplete'] as const)('does not adopt a later complete preview for a captured %s invocation', async kind => {
    draft()
    const { preview, other } = mount(kind)
    const dialog = await review()
    other.append(preview)
    await finishLoading()
    const portal = dialog.closest('[data-app-design-portal]')
    expect(portal).not.toHaveAttribute('data-app-design-pack')
    expect(portal).not.toHaveAttribute('data-app-design-owner')
  })

  it('retains real row order/labels/saved metadata and independent Discard/Resume actions', async () => {
    draft(firstKey, Date.now() - 120_000)
    draft(secondKey, Date.now() - 30_000, '')
    const view = mount()
    await review()
    await finishLoading()
    const rows = within(screen.getByTestId('draft-restore-modal-list')).getAllByRole('listitem')
    expect(rows.map(row => row.getAttribute('data-testid'))).toEqual([
      `draft-restore-row-${secondKey}`, `draft-restore-row-${firstKey}`,
    ])
    expect(rows[0]).toHaveTextContent('Unsaved draft')
    expect(rows[0]).toHaveTextContent('Saved ')
    expect(rows[1]).toHaveTextContent('Private alert draft')
    fireEvent.click(screen.getByTestId(`draft-restore-discard-${secondKey}`))
    expect(localStorage.getItem(secondKey)).toBeNull()
    expect(localStorage.getItem(firstKey)).not.toBeNull()
    expect(screen.queryByTestId(`draft-restore-row-${secondKey}`)).toBeNull()
    fireEvent.click(screen.getByTestId(`draft-restore-resume-${firstKey}`))
    expect(view.getLocation()).toBe('/alert-studio?id=42')
    expect(localStorage.getItem(firstKey)).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sessionStorage.getItem('teslasync:draft-prompt-shown:v1')).toBe('1')
  })

  it('keeps the existing live index subscription active before the cold body resolves', async () => {
    draft()
    draft(secondKey)
    mount()
    await review()
    act(() => index.discardDraftEnvelope(firstKey))
    await finishLoading()
    expect(screen.queryByTestId(`draft-restore-row-${firstKey}`)).toBeNull()
    expect(screen.getByTestId(`draft-restore-row-${secondKey}`)).toBeVisible()
  })

  it('closes on an empty live index while loading and ignores its late body', async () => {
    draft()
    mount()
    await review()
    act(() => index.discardDraftEnvelope(firstKey))
    await finishLoading(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('draft-restore-prompt')).toBeNull()
    expect(sessionStorage.getItem('teslasync:draft-prompt-shown:v1')).toBeNull()
  })

  it('contains failure and safely retries the same invocation without clearing or reporting draft content', async () => {
    draft()
    const original = localStorage.getItem(firstKey)
    const { preview, other } = mount()
    const dialog = await review()
    const error = new Error('Review module unavailable')
    await act(async () => { rejectModule(error); await vi.dynamicImportSettled() })
    expect(screen.getByRole('alert')).toHaveTextContent('Component failed to load')
    expect(within(dialog).getByRole('button', { name: 'Close', exact: true })).toBeEnabled()
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ cause: error }), 'react')
    expect(JSON.stringify(reported.mock.calls)).not.toContain('Private alert draft')
    expect(JSON.stringify(reported.mock.calls)).not.toContain('Do not lose this draft')
    expect(localStorage.getItem(firstKey)).toBe(original)
    other.append(preview)
    const module = await vi.importActual<ContentModule>('./DraftRestoreReviewContent')
    vi.doMock('@/components/feedback/DraftRestoreReviewContent', () => module)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('draft-restore-modal-list')
    expect(dialog.closest('[data-app-design-portal]')).toHaveAttribute('data-app-design-pack', 'editorial')
    expect(dialog.closest('[data-app-design-portal]')).toHaveAttribute('lang', 'ar')
    fireEvent.click(screen.getByTestId('draft-restore-modal-close'))
    expect(localStorage.getItem(firstKey)).toBe(original)
  })

  it('ignores a rejected import after the recovery host unmounts without clearing saved work', async () => {
    draft()
    const view = mount()
    await review()
    view.unmount()
    await act(async () => { rejectModule(new Error('Late module failure')); await vi.dynamicImportSettled() })
    expect(reported).not.toHaveBeenCalled()
    expect(localStorage.getItem(firstKey)).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
