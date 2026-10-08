import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { cn } from '@/lib/cn'

const stream = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  state: 'idle' as const,
  error: null,
}))
const permissions = vi.hoisted(() => ({ enabled: true }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))
vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => permissions.enabled }))
vi.mock('@/hooks/useAiStream', () => ({ useAiStream: () => stream }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))

import { HelixSidePanel } from './HelixSidePanel'

beforeEach(() => {
  permissions.enabled = true
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  vi.clearAllMocks()
})

describe('HelixSidePanel', () => {
  it('preserves named dock geometry overrides in both merge orders and responsive contexts', () => {
    const geometry = [
      ['w-side-panel', 'w-96', 'w-[420px]'],
      ['max-w-side-panel-viewport', 'max-w-full', 'max-w-[40vw]'],
      ['min-h-side-panel-header', 'min-h-16', 'min-h-[4.5rem]'],
    ]

    for (const [named, ordinary, arbitrary] of geometry) {
      for (const prefix of ['', 'xl:']) {
        for (const competing of [ordinary, arbitrary]) {
          expect(cn(`${prefix}${named}`, `${prefix}${competing}`)).toBe(`${prefix}${competing}`)
          expect(cn(`${prefix}${competing}`, `${prefix}${named}`)).toBe(`${prefix}${named}`)
        }
      }
    }

    expect(cn('w-side-panel', 'max-w-side-panel-viewport', 'min-h-side-panel-header'))
      .toBe('w-side-panel max-w-side-panel-viewport min-h-side-panel-header')
    expect(cn('w-side-panel', 'xl:w-96')).toBe('w-side-panel xl:w-96')
    expect(cn('xl:w-96', 'w-side-panel')).toBe('xl:w-96 w-side-panel')
  })

  it('renders a full-width composer with an integrated privacy control and Send action', () => {
    render(
      <MemoryRouter>
        <div id="helix-dock-slot" />
        <HelixSidePanel open onClose={() => {}} />
      </MemoryRouter>,
    )

    const panel = screen.getByRole('complementary', { name: 'Helix chat' })
    const textarea = screen.getByRole('textbox', { name: 'Ask Helix' })
    const composer = textarea.closest('[data-role="helix-composer"]')
    const send = screen.getByRole('button', { name: 'Send' })

    expect(panel.contains(composer ?? null)).toBe(true)
    expect(composer).toHaveClass('w-full', 'focus-within:ring-2')
    expect(textarea).toHaveClass('resize-none', 'border-0', 'bg-transparent')
    expect(composer).toContainElement(screen.getByRole('switch', { name: 'Include visible page text' }))
    expect(composer).toContainElement(send)
    expect(send).toHaveClass('shrink-0', 'rounded-full')
    expect(send).toHaveClass('h-11', 'w-11', 'md:h-9', 'md:w-9')
    expect(panel).toHaveClass('min-w-0', 'border-s')
    expect(panel).toHaveClass('w-side-panel', 'max-w-side-panel-viewport')
    expect(screen.getByRole('heading', { name: 'Helix chat' }).parentElement).toHaveClass('min-h-side-panel-header')
    expect(send).toBeDisabled()

    fireEvent.change(textarea, { target: { value: 'What is on this page?' } })
    expect(send).toBeEnabled()
  })

  it('focuses the composer and preserves button and Escape dismissal', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <div id="helix-dock-slot" />
        <HelixSidePanel open={false} onClose={onClose} />
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter>
        <div id="helix-dock-slot" />
        <HelixSidePanel open onClose={onClose} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('textbox', { name: 'Ask Helix' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Close Helix chat' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps Shift+Enter editing and submits once with Enter', () => {
    render(
      <MemoryRouter>
        <div id="helix-dock-slot" />
        <HelixSidePanel open onClose={() => {}} />
      </MemoryRouter>,
    )

    const textarea = screen.getByRole('textbox', { name: 'Ask Helix' })
    fireEvent.change(textarea, { target: { value: 'Explain this page' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(stream.start).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(stream.start).toHaveBeenCalledTimes(1)
    expect(textarea).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(stream.start).toHaveBeenCalledTimes(1)
  })

  it('keeps chat opt-in and the real configuration destination when disabled', () => {
    permissions.enabled = false
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <div id="helix-dock-slot" />
        <HelixSidePanel open onClose={onClose} />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Enable Helix chat in integrations to ask about this page.')).toBeVisible()
    const configure = screen.getByRole('link', { name: 'Configure Helix' })
    expect(configure).toHaveAttribute('href', '/integrations/helix')
    fireEvent.click(configure)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stream.start).not.toHaveBeenCalled()
  })
})
