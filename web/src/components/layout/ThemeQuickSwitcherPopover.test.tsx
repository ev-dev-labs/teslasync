import { useRef, useState, type RefObject } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../ui/Button'
import type { ThemePickerProps } from '../ui/ThemePicker'
import { ThemeQuickSwitcherPopover } from './ThemeQuickSwitcherPopover'

const loading = vi.hoisted(() => ({
  release: null as (() => void) | null,
  pending: null as Promise<void> | null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

vi.mock('@/components/ui/ThemePicker', async () => {
  await new Promise<void>(resolve => { loading.release = resolve })
  const { useState } = await import('react')
  const { Button } = await import('../ui/Button')
  const { Modal } = await import('../ui/Modal')
  return {
    ThemePicker: ({ compact, showMode, showCustom, onChange, onModeChange }: ThemePickerProps) => {
      const [browse, setBrowse] = useState(false)
      if (loading.pending) throw loading.pending
      return (
        <div
          data-testid="loaded-picker"
          data-compact={compact}
          data-show-mode={showMode}
          data-show-custom={showCustom}
        >
          <Button onClick={() => onModeChange?.('dark')}>Dark</Button>
          <Button onClick={() => onModeChange?.('light')}>Light</Button>
          <Button onClick={() => onChange?.('neon-cyan')}>Signal Blue</Button>
          <Button onClick={() => setBrowse(true)}>Browse all modes</Button>
          <Modal open={browse} onClose={() => setBrowse(false)} title="All modes">
            <Button onClick={() => onModeChange?.('oled')}>OLED</Button>
          </Modal>
        </div>
      )
    },
  }
})

function Harness({
  coords = { top: 64, right: 8 },
  customize = () => undefined,
  returnRef,
  mounted = true,
}: {
  coords?: { top: number; left?: number; right?: number }
  customize?: () => void
  returnRef?: RefObject<HTMLButtonElement>
  mounted?: boolean
}) {
  const localTrigger = useRef<HTMLButtonElement>(null)
  const triggerRef = returnRef ?? localTrigger
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button ref={triggerRef} onClick={() => setOpen(previous => !previous)}>Open picker</Button>
      <Button>Outside action</Button>
      {open && mounted && (
        <ThemeQuickSwitcherPopover
          coords={coords}
          popoverRef={popoverRef}
          triggerRef={triggerRef}
          onClose={() => setOpen(false)}
          onCustomize={() => {
            setOpen(false)
            customize()
          }}
        />
      )}
    </>
  )
}

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute('dir')
  document.documentElement.style.fontSize = ''
  loading.pending = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openPicker() {
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', { name: 'Open picker' })
  trigger.focus()
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', { name: 'Open theme picker' })
  return { user, trigger, dialog }
}

describe('ThemeQuickSwitcherPopover — focus lifecycle', () => {
  it('focuses the loading dialog on Enter, then the lazy controls once they commit', async () => {
    render(<Harness />)
    const { user, dialog } = await openPicker()
    expect(dialog).toHaveFocus()
    expect(within(dialog).getByRole('status', { name: 'Loading theme picker…' })).toBeInTheDocument()
    expect(dialog).not.toHaveAttribute('aria-modal', 'true')
    expect(document.body).not.toHaveAttribute('inert')
    await waitFor(() => expect(loading.release).not.toBeNull())
    const release = loading.release
    if (!release) throw new Error('Lazy picker import did not request its release')
    await act(async () => { release() })
    const firstMode = await within(dialog).findByRole('button', { name: 'Dark' })
    await waitFor(() => expect(firstMode).toHaveFocus())
    const picker = within(dialog).getByTestId('loaded-picker')
    expect(picker).toHaveAttribute('data-compact', 'true')
    expect(picker).toHaveAttribute('data-show-mode', 'true')
    expect(picker).toHaveAttribute('data-show-custom', 'false')
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Outside action' })).toHaveFocus()
    firstMode.focus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Light' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Signal Blue' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Browse all modes' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Customize…' })).toHaveFocus()
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(false)
  })

  it('restores the trigger after selecting a mode or an accent without changing picker choices', async () => {
    render(<Harness />)
    const { user, trigger, dialog } = await openPicker()
    await within(dialog).findByRole('button', { name: 'Light' })
    await user.click(within(dialog).getByRole('button', { name: 'Light' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Signal Blue' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('keeps nested Modal Escape local, restores Browse, and preserves the parent controls', async () => {
    render(<Harness />)
    const { user, dialog } = await openPicker()
    const browse = await within(dialog).findByRole('button', { name: 'Browse all modes' })
    await user.click(browse)
    const child = screen.getByRole('dialog', { name: 'All modes' })
    expect(child).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(child.contains(document.activeElement)).toBe(true))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'All modes' })).toBeNull()
    expect(dialog).toBeInTheDocument()
    expect(browse).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Customize…' })).toHaveFocus()
  })

  it('does not steal focus from an outside action when dismissed', async () => {
    const view = render(<Harness />)
    await openPicker()
    const outside = screen.getByRole('button', { name: 'Outside action' })
    outside.focus()
    view.rerender(<Harness mounted={false} />)
    expect(outside).toHaveFocus()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not steal intentional outside focus when suspended controls finish loading', async () => {
    let release: () => void = () => { throw new Error('Picker release was not initialized') }
    loading.pending = new Promise<void>(resolve => { release = resolve })
    render(<Harness />)
    const { dialog } = await openPicker()
    expect(dialog).toHaveFocus()
    const outside = screen.getByRole('button', { name: 'Outside action' })
    outside.focus()
    await act(async () => {
      loading.pending = null
      release()
    })
    expect(await within(dialog).findByRole('button', { name: 'Dark' })).toBeInTheDocument()
    expect(outside).toHaveFocus()
  })

  it('does not restore over another live modal even when focus has fallen to body', async () => {
    const view = render(<Harness />)
    const { trigger } = await openPicker()
    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    document.body.append(modal)
    try {
      const focus = vi.spyOn(trigger, 'focus')
      ;(document.activeElement as HTMLElement).blur()
      expect(document.body).toHaveFocus()
      view.rerender(<Harness mounted={false} />)
      expect(focus).not.toHaveBeenCalled()
    } finally {
      modal.remove()
    }
  })

  it('does not restore a hidden trigger on dismissal', async () => {
    render(<Harness />)
    const { trigger, dialog } = await openPicker()
    const mode = await within(dialog).findByRole('button', { name: 'Dark' })
    trigger.hidden = true
    const focus = vi.spyOn(trigger, 'focus')
    mode.focus()
    fireEvent.click(mode)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focus).not.toHaveBeenCalled()
  })

  it('does not restore a disconnected trigger on dismissal', async () => {
    const triggerRef = { current: null } as { current: HTMLButtonElement | null }
    render(<Harness returnRef={triggerRef} />)
    const { trigger, dialog } = await openPicker()
    const mode = await within(dialog).findByRole('button', { name: 'Dark' })
    const disconnected = document.createElement('button')
    const focus = vi.spyOn(disconnected, 'focus')
    triggerRef.current = disconnected
    mode.focus()
    fireEvent.click(mode)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focus).not.toHaveBeenCalled()
    expect(trigger).not.toHaveFocus()
  })

  it('suppresses trigger restoration for Customize navigation', async () => {
    const customize = vi.fn()
    render(<Harness customize={customize} />)
    const { user, trigger, dialog } = await openPicker()
    const focus = vi.spyOn(trigger, 'focus')
    await user.click(within(dialog).getByRole('button', { name: 'Customize…' }))
    expect(customize).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focus).not.toHaveBeenCalled()
  })
})

describe('ThemeQuickSwitcherPopover — viewport containment', () => {
  it.each([
    { width: 375, height: 844, top: 64, dir: 'ltr' },
    { width: 320, height: 320, top: 64, dir: 'rtl' },
    { width: 1440, height: 900, top: 80, dir: 'ltr' },
  ])('owns vertical scrolling at $width × $height with $dir placement', async ({ width, height, top, dir }) => {
    vi.stubGlobal('innerWidth', width)
    vi.stubGlobal('innerHeight', height)
    document.documentElement.dir = dir
    document.documentElement.style.fontSize = '32px'
    render(<Harness coords={{ top, left: 8 }} />)
    const { user, dialog } = await openPicker()
    await within(dialog).findByRole('button', { name: 'Dark' })
    expect(dialog.style.top).toBe(`${top}px`)
    expect(dialog.style.left).toBe('8px')
    expect(dialog.style.right).toBe('')
    const expectedBounds = document.createElement('div')
    expectedBounds.style.maxHeight = `max(0px, calc(100dvh - ${top}px - 0.5rem - env(safe-area-inset-bottom, 0px)))`
    expect(dialog.style.maxHeight).toBe(expectedBounds.style.maxHeight)
    expect(dialog).toHaveClass('overflow-y-auto', 'max-w-shell-panel-viewport', 'w-theme-switcher')
    await user.tab()
    await user.tab()
    await user.tab()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Customize…' })).toHaveFocus()
  })

  it('updates only computed bounds on coordinate changes without refocusing or losing actions', async () => {
    const view = render(<Harness coords={{ top: 64, right: 8 }} />)
    const { user, dialog } = await openPicker()
    const light = await within(dialog).findByRole('button', { name: 'Light' })
    await user.tab()
    expect(light).toHaveFocus()
    view.rerender(<Harness coords={{ top: 120, right: 16 }} />)
    expect(dialog.style.top).toBe('120px')
    expect(dialog.style.right).toBe('16px')
    expect(dialog.style.maxHeight).toContain('120px')
    expect(light).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Customize…' })).toBeInTheDocument()
  })
})
