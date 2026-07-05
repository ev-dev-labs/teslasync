import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Spinner } from './Spinner'

// Toggle reduced-motion per test WITHOUT touching framer-motion / matchMedia.
// jsdom has no `window.matchMedia`, and `useMotionPreference` probes it via
// framer-motion's `useReducedMotion`, so we mock the project hook directly.
const motionState = vi.hoisted(() => ({ reduce: false }))
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({
    reduce: motionState.reduce,
    durationMs: motionState.reduce ? 0 : 250,
  }),
}))

// i18n passthrough: honour the default-value fallback so the accessible label
// resolves without booting the full i18n runtime.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue?: string) => defaultValue ?? _key,
  }),
}))

const status = () => screen.getByRole('status')

describe('Spinner', () => {
  beforeEach(() => {
    motionState.reduce = false
  })

  it('renders an accessible status region with the default label when none is given', () => {
    const { container } = render(<Spinner />)
    expect(status()).toBeInTheDocument()
    expect(status()).toHaveAccessibleName('Loading')
    // No caption is rendered when there is no label.
    expect(container.querySelector('span')).toBeNull()
    // The decorative bolt is hidden from the accessibility tree.
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('defaults to the md size (48px bolt) and applies its box class', () => {
    const { container } = render(<Spinner />)
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('width', '48')
    expect(svg).toHaveAttribute('height', '48')
    expect(container.querySelector('.h-12.w-12')).not.toBeNull()
  })

  it.each([
    ['sm', '24', 'h-6.w-6', '22'],
    ['md', '48', 'h-12.w-12', '14'],
    ['lg', '80', 'h-20.w-20', '10'],
  ] as const)('sizes the bolt + stroke for size=%s', (size, px, boxSelector, stroke) => {
    const { container } = render(<Spinner size={size} />)
    expect(container.querySelector('svg')).toHaveAttribute('width', px)
    expect(container.querySelector(`.${boxSelector}`)).not.toBeNull()
    expect(container.querySelector('path')).toHaveAttribute('stroke-width', stroke)
  })

  it('shows the label as both the visible caption and the accessible name', () => {
    render(<Spinner label="Loading drives…" />)
    expect(status()).toHaveAccessibleName('Loading drives…')
    expect(screen.getByText('Loading drives…')).toBeInTheDocument()
  })

  it('treats an empty / whitespace-only label as no label (a11y hardening)', () => {
    const { container } = render(<Spinner label="   " />)
    // Falls back to the default accessible name…
    expect(status()).toHaveAccessibleName('Loading')
    // …and renders no empty caption span.
    expect(container.querySelector('span')).toBeNull()
  })

  it('merges a custom className onto the root without dropping the base layout classes', () => {
    render(<Spinner className="custom-spinner mt-8" />)
    expect(status()).toHaveClass('custom-spinner', 'mt-8')
    expect(status()).toHaveClass('flex', 'flex-col', 'items-center')
  })

  it('does not throw and falls back to md for an unknown size', () => {
    // Simulate an untyped / JS caller passing a bad size value.
    const { container } = render(<Spinner size={'xl' as unknown as 'md'} />)
    expect(container.querySelector('svg')).toHaveAttribute('width', '48')
    expect(container.querySelector('.h-12.w-12')).not.toBeNull()
  })

  it('runs the draw animation when motion is allowed', () => {
    motionState.reduce = false
    const { container } = render(<Spinner />)
    const path = container.querySelector('path')
    expect(path).toHaveClass('spinner-bolt-draw')
    expect(path).toHaveAttribute('fill-opacity', '0')
    expect(path).toHaveAttribute('stroke-dashoffset', '100')
    expect(path).toHaveAttribute('stroke-dasharray', '100')
  })

  it('renders a static, fully-filled bolt when reduced motion is requested', () => {
    motionState.reduce = true
    const { container } = render(<Spinner />)
    const path = container.querySelector('path')
    expect(path).not.toHaveClass('spinner-bolt-draw')
    expect(path).toHaveAttribute('fill-opacity', '1')
    expect(path).toHaveAttribute('stroke-dashoffset', '0')
    expect(path).toHaveAttribute('stroke-dasharray', 'none')
  })
})
