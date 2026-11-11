import { useState, type ComponentProps } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandPalette } from '@/components/ui/CommandPalette'
import { AppDesignPortal } from '@/components/ui/AppDesignPortal'
import { Modal } from '@/components/ui/Modal'
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs'
import { MemoryRouter } from 'react-router-dom'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

const loader = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/components/ui/CommandPaletteTrigger', () => ({
  loadCommandPalette: loader.load,
}))

const Palette = vi.fn((_props: ComponentProps<typeof CommandPalette>) => (
  <div data-testid="loaded-command-palette" />
))
let CommandPaletteHost: typeof import('./CommandPaletteHost').CommandPaletteHost

beforeEach(async () => {
  vi.resetModules()
  Palette.mockClear()
  loader.load.mockReset()
  loader.load.mockResolvedValue({ CommandPalette: Palette })
  const module = await import('./CommandPaletteHost')
  CommandPaletteHost = module.CommandPaletteHost
})
afterEach(cleanup)

function ShortcutHost() {
  useKeyboardShortcuts()
  return null
}

describe('CommandPaletteHost first activation', () => {
  it.each([
    ['explicit', 'detached'],
    ['explicit', 'reparented'],
    ['keyboard', 'detached'],
    ['keyboard', 'reparented'],
  ] as const)('retains the verified %s snapshot after its invocation boundary is %s before lazy resolution', async (invocation, mutation) => {
    const root = document.documentElement
    const attributes = getAppDesignAttributes('terminal')
    const previous = Object.keys(attributes).map(name => [name, root.getAttribute(name)] as const)
    const fixture = document.createElement('section')
    const locale = document.createElement('section')
    locale.setAttribute('dir', 'rtl')
    locale.setAttribute('lang', 'ar')
    const preview = document.createElement('section')
    preview.setAttribute('data-app-design-preview', '')
    for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) preview.setAttribute(name, value)
    const origin = document.createElement('button')
    origin.textContent = 'Original preview invocation'
    preview.append(origin)
    locale.append(preview)
    const other = document.createElement('section')
    other.setAttribute('data-app-design-preview', '')
    other.setAttribute('dir', 'ltr')
    other.setAttribute('lang', 'en')
    for (const [name, value] of Object.entries(getAppDesignAttributes('bauhaus'))) other.setAttribute(name, value)
    const surviving = document.createElement('button')
    surviving.textContent = 'Surviving focus target'
    fixture.append(locale, other, surviving)
    document.body.append(fixture)
    for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
    const release = observeAppDesignScopes(root)
    const DeferredPalette = vi.fn(function DeferredPalette(props: ComponentProps<typeof CommandPalette>) {
      const [open, setOpen] = useState(true)
      return open ? (
        <AppDesignPortal inline origin={props.initialOrigin} originSnapshot={props.initialDesignOrigin}>
          <Modal open onClose={() => setOpen(false)} ariaLabel="Deferred actual dialog">
            <input aria-label="Deferred native field" />
          </Modal>
        </AppDesignPortal>
      ) : null
    })
    let resolveModule!: (module: { CommandPalette: typeof DeferredPalette }) => void
    loader.load.mockReturnValue(new Promise(resolve => { resolveModule = resolve }))
    const view = render(<MemoryRouter><ShortcutHost /><CommandPaletteHost /></MemoryRouter>)
    try {
      if (invocation === 'keyboard') origin.focus()
      else surviving.focus()
      act(() => {
        if (invocation === 'keyboard') fireEvent.keyDown(origin, { key: 'k', ctrlKey: true })
        else window.dispatchEvent(new CustomEvent('toggle-command-palette', { detail: { origin } }))
      })
      expect(loader.load).toHaveBeenCalledOnce()
      expect(screen.queryByRole('dialog')).toBeNull()
      act(() => {
        if (mutation === 'detached') {
          preview.remove()
          origin.remove()
        } else {
          other.append(preview, origin)
          for (const [name, value] of Object.entries(getAppDesignAttributes('bauhaus'))) preview.setAttribute(name, value)
        }
        surviving.focus()
      })
      await act(async () => { resolveModule({ CommandPalette: DeferredPalette }) })
      const dialog = await screen.findByRole('dialog', { name: 'Deferred actual dialog' })
      const boundary = dialog.closest('[data-app-design-portal]')
      expect(boundary?.parentElement).toBe(document.body)
      for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) {
        expect(boundary).toHaveAttribute(name, value)
      }
      expect(boundary).toHaveAttribute('dir', 'rtl')
      expect(boundary).toHaveAttribute('lang', 'ar')
      expect(dialog).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial'))
      expect(dialog).not.toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-terminal'))
      expect(DeferredPalette.mock.lastCall?.[0].initialOrigin).toBe(origin)
      expect(screen.getByRole('textbox', { name: 'Deferred native field' })).toHaveFocus()
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Deferred native field' }), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(surviving).toHaveFocus()
    } finally {
      view.unmount()
      release()
      fixture.remove()
      for (const [name, value] of previous) {
        if (value === null) root.removeAttribute(name)
        else root.setAttribute(name, value)
      }
    }
  })

  it.each(['incomplete', 'default'] as const)('keeps the first %s invocation neutral instead of borrowing a later preview', async kind => {
    const root = document.documentElement
    const attributes = getAppDesignAttributes('terminal')
    const previous = Object.keys(attributes).map(name => [name, root.getAttribute(name)] as const)
    for (const name of Object.keys(attributes)) root.removeAttribute(name)
    if (kind === 'incomplete') {
      for (const [name, value] of Object.entries(attributes)) root.setAttribute(name, value)
    }
    const fixture = document.createElement('section')
    const preview = document.createElement('section')
    if (kind === 'incomplete') {
      preview.setAttribute('data-app-design-preview', '')
      for (const [name, value] of Object.entries(getAppDesignAttributes('editorial'))) preview.setAttribute(name, value)
      preview.removeAttribute('data-app-controls')
    }
    const origin = document.createElement('button')
    preview.append(origin)
    const other = document.createElement('section')
    other.setAttribute('data-app-design-preview', '')
    for (const [name, value] of Object.entries(getAppDesignAttributes('bauhaus'))) other.setAttribute(name, value)
    fixture.append(preview, other)
    document.body.append(fixture)
    const release = observeAppDesignScopes(root)
    const DeferredPalette = vi.fn((props: ComponentProps<typeof CommandPalette>) => (
      <AppDesignPortal inline origin={props.initialOrigin} originSnapshot={props.initialDesignOrigin}>
        <Modal open onClose={() => {}} ariaLabel="Neutral deferred dialog"><p>Details</p></Modal>
      </AppDesignPortal>
    ))
    let resolveModule!: (module: { CommandPalette: typeof DeferredPalette }) => void
    loader.load.mockReturnValue(new Promise(resolve => { resolveModule = resolve }))
    const view = render(<CommandPaletteHost />)
    try {
      act(() => { window.dispatchEvent(new CustomEvent('toggle-command-palette', { detail: { origin } })) })
      act(() => {
        preview.remove()
        other.append(origin)
        origin.focus()
      })
      await act(async () => { resolveModule({ CommandPalette: DeferredPalette }) })
      const dialog = await screen.findByRole('dialog', { name: 'Neutral deferred dialog' })
      const boundary = dialog.closest('[data-app-design-portal]')
      expect(boundary?.parentElement).toBe(document.body)
      expect(boundary).toHaveAttribute('data-app-design-preview')
      expect(boundary).not.toHaveAttribute('data-app-design-pack')
      expect(dialog).not.toHaveAttribute('data-app-design-owner')
      expect(DeferredPalette.mock.lastCall?.[0].initialOrigin).toBe(origin)
    } finally {
      view.unmount()
      release()
      fixture.remove()
      for (const [name, value] of previous) {
        if (value === null) root.removeAttribute(name)
        else root.setAttribute(name, value)
      }
    }
  })

  it('retains the first explicit origin while the lazy palette is unresolved, without relying on pointer focus', async () => {
    let resolveModule!: (module: { CommandPalette: typeof Palette }) => void
    loader.load.mockReturnValue(new Promise(resolve => { resolveModule = resolve }))
    const onOpen = vi.fn()
    const onPin = vi.fn()
    const onUnpin = vi.fn()
    const fallback = document.createElement('button')
    const returnFocusFallbackRef = { current: fallback }
    render(
      <>
        <a href="#focused" data-testid="focused-invoker">Focused invoker</a>
        <CommandPaletteHost onOpen={onOpen} onPin={onPin} onUnpin={onUnpin} returnFocusFallbackRef={returnFocusFallbackRef} />
      </>,
    )
    const origin = document.createElement('button')
    const laterOrigin = document.createElement('button')
    screen.getByTestId('focused-invoker').focus()

    expect(loader.load).not.toHaveBeenCalled()
    expect(origin).not.toHaveFocus()
    act(() => {
      window.dispatchEvent(new CustomEvent('toggle-command-palette', { detail: { origin } }))
      window.dispatchEvent(new CustomEvent('toggle-command-palette', { detail: { origin: laterOrigin } }))
    })
    expect(loader.load).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('loaded-command-palette')).not.toBeInTheDocument()

    await act(async () => { resolveModule({ CommandPalette: Palette }) })
    expect(await screen.findByTestId('loaded-command-palette')).toBeInTheDocument()
    expect(Palette.mock.lastCall?.[0]).toMatchObject({
      initialOpen: true,
      initialOrigin: origin,
      onOpen,
      onPin,
      onUnpin,
      returnFocusFallbackRef,
    })
    expect(origin).not.toHaveFocus()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['no event detail', undefined],
    ['null origin', null],
    ['string origin', 'not-an-element'],
    ['object origin', { id: 'not-an-element' }],
  ])('snapshots the focused preview invoker with %s before the lazy import resolves', async (_label, origin) => {
    let resolveModule!: (module: { CommandPalette: typeof Palette }) => void
    loader.load.mockReturnValue(new Promise(resolve => { resolveModule = resolve }))
    render(
      <>
        <div data-app-design-preview>
          <a href="#preview" data-testid="preview-invoker">Preview invoker</a>
        </div>
        <a href="#outside" data-testid="outside-invoker">Outside invoker</a>
        <CommandPaletteHost />
      </>,
    )
    const previewInvoker = screen.getByTestId('preview-invoker')
    const outsideInvoker = screen.getByTestId('outside-invoker')
    previewInvoker.focus()
    expect(previewInvoker).toHaveFocus()
    act(() => {
      window.dispatchEvent(origin === undefined
        ? new Event('toggle-command-palette')
        : new CustomEvent('toggle-command-palette', { detail: { origin } }))
    })
    expect(loader.load).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('loaded-command-palette')).not.toBeInTheDocument()

    outsideInvoker.focus()
    expect(outsideInvoker).toHaveFocus()
    await act(async () => { resolveModule({ CommandPalette: Palette }) })
    expect(await screen.findByTestId('loaded-command-palette')).toBeInTheDocument()
    expect(Palette.mock.lastCall?.[0]).toMatchObject({ initialOpen: true, initialOrigin: previewInvoker })
    expect(outsideInvoker).toHaveFocus()
  })

  it('keeps keyboard activation compatible when the event has no origin detail', async () => {
    render(<CommandPaletteHost />)
    act(() => { window.dispatchEvent(new Event('toggle-command-palette')) })
    expect(await screen.findByTestId('loaded-command-palette')).toBeInTheDocument()
    expect(Palette.mock.lastCall?.[0]).toMatchObject({ initialOpen: true, initialOrigin: null })
  })

  it('does not use the document root as a focused origin', async () => {
    const root = document.documentElement
    const previousTabIndex = root.getAttribute('tabindex')
    try {
      root.tabIndex = -1
      root.focus()
      expect(root).toHaveFocus()
      render(<CommandPaletteHost />)
      act(() => { window.dispatchEvent(new Event('toggle-command-palette')) })
      expect(await screen.findByTestId('loaded-command-palette')).toBeInTheDocument()
      expect(Palette.mock.lastCall?.[0]).toMatchObject({ initialOpen: true, initialOrigin: null })
    } finally {
      root.blur()
      if (previousTabIndex === null) root.removeAttribute('tabindex')
      else root.setAttribute('tabindex', previousTabIndex)
    }
  })

  it.each([null, 'not-an-element', { id: 'not-an-element' }])(
    'does not forward a malformed origin %j into the palette',
    async origin => {
      render(<CommandPaletteHost />)
      act(() => { window.dispatchEvent(new CustomEvent('toggle-command-palette', { detail: { origin } })) })
      expect(await screen.findByTestId('loaded-command-palette')).toBeInTheDocument()
      expect(Palette.mock.lastCall?.[0]).toMatchObject({ initialOpen: true, initialOrigin: null })
    },
  )
})
