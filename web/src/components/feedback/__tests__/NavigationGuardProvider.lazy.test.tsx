import { StrictMode, useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from '../../ui/Input'
import { useDirtyForm } from '@/hooks/useDirtyForm'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))
const reported = vi.hoisted(() => vi.fn())
vi.mock('@/lib/errorReporter', () => ({ reportFrontendError: reported }))

type DialogModule = typeof import('../../ui/ConfirmDialog')
type GuardModule = typeof import('../NavigationGuardProvider')
let Provider: GuardModule['NavigationGuardProvider']
let useGuardContext: GuardModule['useNavigationGuardContext']
let context: ReturnType<GuardModule['useNavigationGuardContext']>
let getAttributes: typeof import('../../ui/app-designs/designs')['getAppDesignAttributes']
let observeScopes: typeof import('../../ui/app-designs/designs')['observeAppDesignScopes']
let resolveModule: (module: DialogModule) => void
let rejectModule: (error: Error) => void
let load: ReturnType<typeof vi.fn<() => Promise<DialogModule>>>
const releases: Array<() => void> = []
const fixtures: HTMLElement[] = []

beforeEach(async () => {
  vi.resetModules()
  reported.mockClear()
  const pending = new Promise<DialogModule>((resolve, reject) => {
    resolveModule = resolve
    rejectModule = reject
  })
  load = vi.fn(() => pending)
  vi.doMock('@/components/ui/ConfirmDialog', load)
  const designs = await import('../../ui/app-designs/designs')
  getAttributes = designs.getAppDesignAttributes
  observeScopes = designs.observeAppDesignScopes
  const module = await import('../NavigationGuardProvider')
  Provider = module.NavigationGuardProvider
  useGuardContext = module.useNavigationGuardContext
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  for (const release of releases.splice(0)) release()
  for (const fixture of fixtures.splice(0)) fixture.remove()
  for (const name of Object.keys(getAttributes('classic'))) document.documentElement.removeAttribute(name)
  vi.doUnmock('@/components/ui/ConfirmDialog')
  vi.restoreAllMocks()
  localStorage.clear()
})

function Draft() {
  context = useGuardContext()
  const { register } = context
  useEffect(() => register({
    id: 'draft', isDirty: () => true, getMessage: () => 'Uncommitted edits',
  }), [register])
  useDirtyForm(true)
  return <Input label="Draft" defaultValue="Unsaved draft text" />
}

function mount() {
  return render(<StrictMode><MemoryRouter><Provider><Draft /></Provider></MemoryRouter></StrictMode>)
}

function invocation(kind: 'complete' | 'incomplete' | 'default' = 'complete') {
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
  const origin = document.createElement('button')
  origin.textContent = 'Original invocation'
  preview.append(origin)
  locale.append(preview)
  const other = document.createElement('section')
  other.setAttribute('data-app-design-preview', '')
  other.setAttribute('dir', 'ltr')
  other.setAttribute('lang', 'en')
  for (const [name, value] of Object.entries(getAttributes('bauhaus'))) other.setAttribute(name, value)
  fixture.append(locale, other)
  document.body.append(fixture)
  fixtures.push(fixture)
  releases.push(observeScopes(document.documentElement))
  return { preview, origin, other }
}

async function finishLoading() {
  const module = await vi.importActual<DialogModule>('../../ui/ConfirmDialog')
  await act(async () => { resolveModule(module) })
  return screen.findByRole('dialog', { name: 'Unsaved changes' })
}

describe('NavigationGuardProvider on-demand confirmation', () => {
  it('does not load an unused confirmation and never suspends the mounted draft', () => {
    mount()
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), { target: { value: 'Still editing' } })
    expect(load).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Still editing')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it.each(['detached', 'reparented'] as const)(
    'retains the first profile/locale when its invocation is %s before the real dialog loads',
    async mutation => {
      mount()
      const { preview, origin, other } = invocation()
      origin.focus()
      const result = vi.fn()
      let first!: Promise<boolean>
      let second!: Promise<boolean>
      act(() => {
        first = context.confirmIfDirty()
        second = context.confirmIfDirty()
        void first.then(result)
      })
      expect(second).toBe(first)
      await waitFor(() => expect(load).toHaveBeenCalledOnce())
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.getByRole('status')).toBeInTheDocument()
      const draft = screen.getByRole('textbox', { name: 'Draft' })
      fireEvent.change(draft, { target: { value: 'Kept through lazy loading' } })
      const loadingUnload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(loadingUnload)
      expect(loadingUnload.defaultPrevented).toBe(true)
      if (mutation === 'detached') preview.remove()
      else {
        other.append(preview, origin)
        for (const [name, value] of Object.entries(getAttributes('bauhaus'))) preview.setAttribute(name, value)
      }
      draft.focus()
      const dialog = await finishLoading()
      const boundary = dialog.closest('[data-app-design-portal]')
      expect(boundary).toHaveAttribute('data-app-design-pack', 'editorial')
      expect(boundary).toHaveAttribute('dir', 'rtl')
      expect(boundary).toHaveAttribute('lang', 'ar')
      expect(dialog).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial'))
      expect(dialog).not.toHaveAttribute('originSnapshot')
      expect(dialog).toContainElement(document.activeElement)
      expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft)
      expect(draft).toHaveValue('Kept through lazy loading')
      const beforeUnload = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(beforeUnload)
      expect(beforeUnload.defaultPrevented).toBe(true)
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
      await waitFor(() => expect(result).toHaveBeenCalledOnce())
      expect(result).toHaveBeenCalledWith(false)
      if (mutation === 'reparented') await waitFor(() => expect(origin).toHaveFocus())
      expect(draft).toHaveValue('Kept through lazy loading')
    },
  )

  it.each(['incomplete', 'default'] as const)('does not borrow a later complete preview for a %s invocation', async kind => {
    mount()
    const { preview, origin, other } = invocation(kind)
    origin.focus()
    act(() => { void context.confirmIfDirty() })
    preview.remove()
    other.append(origin)
    const dialog = await finishLoading()
    const boundary = dialog.closest('[data-app-design-portal]')
    expect(boundary).toHaveAttribute('data-app-design-preview')
    expect(boundary).not.toHaveAttribute('data-app-design-pack')
    expect(dialog).not.toHaveAttribute('data-app-design-owner')
    expect(boundary).toHaveAttribute('dir', 'rtl')
    expect(boundary).toHaveAttribute('lang', 'ar')
  })

  it('cancels a loading confirmation with Escape and never opens it after the module arrives', async () => {
    mount()
    const result = vi.fn()
    act(() => { void context.confirmIfDirty().then(result) })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(result).toHaveBeenCalledWith(false))
    const module = await vi.importActual<DialogModule>('../../ui/ConfirmDialog')
    await act(async () => { resolveModule(module) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved draft text')
  })

  it('keeps waiting cancellation accessible and returns focus to the captured invocation', async () => {
    mount()
    const { origin } = invocation()
    origin.focus()
    const result = vi.fn()
    act(() => { void context.confirmIfDirty().then(result) })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    fireEvent.click(cancel)
    await waitFor(() => expect(result).toHaveBeenCalledWith(false))
    expect(origin).toHaveFocus()
    const module = await vi.importActual<DialogModule>('../../ui/ConfirmDialog')
    await act(async () => { resolveModule(module) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Unsaved draft text')
  })

  it('contains an import failure, retains the draft and first invocation, and retries without discarding', async () => {
    mount()
    const { origin, preview, other } = invocation()
    origin.focus()
    const result = vi.fn()
    act(() => { void context.confirmIfDirty().then(result) })
    const error = new Error('Failed to fetch dynamically imported module')
    await act(async () => { rejectModule(error) })
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ cause: error }), 'react')
    expect(screen.getByRole('alert')).toHaveTextContent('Component failed to load')
    expect(result).not.toHaveBeenCalled()
    const draft = screen.getByRole('textbox', { name: 'Draft' })
    expect(draft).toHaveValue('Unsaved draft text')
    other.append(preview, origin)
    const module = await vi.importActual<DialogModule>('../../ui/ConfirmDialog')
    vi.doMock('@/components/ui/ConfirmDialog', () => module)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    expect(dialog.closest('[data-app-design-portal]')).toHaveAttribute('data-app-design-pack', 'editorial')
    expect(dialog.closest('[data-app-design-portal]')).toHaveAttribute('lang', 'ar')
    expect(result).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(result).toHaveBeenCalledWith(false))
    expect(draft).toHaveValue('Unsaved draft text')
    await waitFor(() => expect(origin).toHaveFocus())
  })

  it('settles an unmounted request as cancelled and ignores a late import', async () => {
    const view = mount()
    const result = vi.fn()
    act(() => { void context.confirmIfDirty().then(result) })
    view.unmount()
    await waitFor(() => expect(result).toHaveBeenCalledWith(false))
    const module = await vi.importActual<DialogModule>('../../ui/ConfirmDialog')
    await act(async () => { resolveModule(module) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(result).toHaveBeenCalledOnce()
  })

  it('resolves cancellation when the request and unmount occur before the pending render commits', async () => {
    const { unmount } = mount()
    const result = vi.fn()
    act(() => {
      void context.confirmIfDirty().then(result)
      unmount()
    })
    await waitFor(() => expect(result).toHaveBeenCalledWith(false))
    expect(load).not.toHaveBeenCalled()
  })
})
