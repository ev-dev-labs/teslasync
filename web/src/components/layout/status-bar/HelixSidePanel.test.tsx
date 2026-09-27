import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stream = vi.hoisted(() => ({
  start: vi.fn(),
  cancel: vi.fn(),
  state: 'idle' as const,
  error: null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}))
vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => true }))
vi.mock('@/hooks/useAiStream', () => ({ useAiStream: () => stream }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))

import { HelixSidePanel } from './HelixSidePanel'

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  vi.clearAllMocks()
})

describe('HelixSidePanel', () => {
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
    expect(send).toBeDisabled()

    fireEvent.change(textarea, { target: { value: 'What is on this page?' } })
    expect(send).toBeEnabled()
  })
})
