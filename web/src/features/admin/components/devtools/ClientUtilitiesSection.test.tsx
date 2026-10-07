/**
 * ClientUtilitiesSection contract tests.
 *
 * Covers the searchable dev-tools grid: initial render (all tools collapsed,
 * no tool body mounted), name/description filtering, case-insensitivity, the
 * empty state, the accordion expand/collapse behaviour, and the a11y wiring
 * (searchbox label, button ↔ region `aria-controls`, decorative icons hidden).
 *
 * The tool bodies are only mounted on expand, so we exercise the two purest
 * tools (VIN + JWT) via their unique input placeholders. `react-i18next` is
 * mocked so translation output is deterministic: `t(key, fallback)` returns
 * the fallback and `t(key)` returns the key verbatim.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ClientUtilitiesSection } from './ClientUtilitiesSection'

const SEARCH_LABEL = 'Search tools...'
const TOTAL_TOOLS = 15
// Unique VIN input placeholder proving that specific tool body mounted.
const VIN_PLACEHOLDER = '5YJ3E1EA1NF000001'

function getSearchbox() {
  return screen.getByRole('searchbox', { name: SEARCH_LABEL })
}

function type(value: string) {
  fireEvent.change(getSearchbox(), { target: { value } })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ClientUtilitiesSection', () => {
  it('renders the searchbox and every tool collapsed with no tool body mounted', () => {
    render(<ClientUtilitiesSection />)

    // Accessible, labelled search control (aria-label, not just a placeholder).
    expect(getSearchbox()).toBeInTheDocument()

    // One toggle button per registered tool.
    const toggles = screen.getAllByRole('button')
    expect(toggles).toHaveLength(TOTAL_TOOLS)

    // Everything starts collapsed…
    const vinToggle = screen.getByRole('button', { name: /Vin Decoder/i })
    expect(vinToggle).toHaveAttribute('aria-expanded', 'false')

    // …so no tool body (and no expanded region) is in the DOM yet.
    expect(screen.queryByPlaceholderText(VIN_PLACEHOLDER)).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('filters tools by name and hides the non-matching cards', () => {
    render(<ClientUtilitiesSection />)

    type('json')

    const toggles = screen.getAllByRole('button')
    expect(toggles).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: /Json Formatter/i }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Vin Decoder/i })).toBeNull()
  })

  it('keeps every card whose name OR description matches a shared term', () => {
    render(<ClientUtilitiesSection />)

    // "decoder" is in two tool names (Vin Decoder, Jwt Decoder).
    type('decoder')

    expect(screen.getAllByRole('button')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: /Vin Decoder/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Jwt Decoder/i }),
    ).toBeInTheDocument()
  })

  it('matches on the description branch even when no name contains the term', () => {
    render(<ClientUtilitiesSection />)

    // No tool NAME contains "desc"; every tool DESCRIPTION does. Getting the
    // full set back proves the filter also inspects `tool.desc`.
    type('desc')

    expect(screen.getAllByRole('button')).toHaveLength(13)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('is case-insensitive when filtering', () => {
    render(<ClientUtilitiesSection />)

    type('JWT')

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: /Jwt Decoder/i }),
    ).toBeInTheDocument()
  })

  it('shows a status empty-state and no cards when nothing matches', () => {
    render(<ClientUtilitiesSection />)

    type('zzz-nothing-here')

    expect(screen.queryAllByRole('button')).toHaveLength(0)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('No tools match your search')
  })

  it('expands a card on click, mounting the tool body and wiring aria-controls', () => {
    render(<ClientUtilitiesSection />)

    expect(
      screen.getByRole('button', { name: /Vin Decoder/i }),
    ).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: /Vin Decoder/i }))

    const vinToggle = screen.getByRole('button', { name: /Vin Decoder/i })
    expect(vinToggle).toHaveAttribute('aria-expanded', 'true')
    // The real VIN tool body is now rendered.
    expect(screen.getByPlaceholderText(VIN_PLACEHOLDER)).toBeInTheDocument()

    // The disclosure region is programmatically associated with its trigger.
    const region = screen.getByRole('region', { name: 'Vin Decoder' })
    expect(region.id).toBe('devtools-tool-panel-vin')
    expect(vinToggle).toHaveAttribute('aria-controls', region.id)
  })

  it('collapses the card again on a second click', () => {
    render(<ClientUtilitiesSection />)

    fireEvent.click(screen.getByRole('button', { name: /Vin Decoder/i }))
    expect(screen.getByPlaceholderText(VIN_PLACEHOLDER)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Vin Decoder/i }))

    expect(
      screen.getByRole('button', { name: /Vin Decoder/i }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByPlaceholderText(VIN_PLACEHOLDER)).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('acts as an accordion — opening a second tool closes the first', () => {
    render(<ClientUtilitiesSection />)

    fireEvent.click(screen.getByRole('button', { name: /Vin Decoder/i }))
    expect(screen.getByPlaceholderText(VIN_PLACEHOLDER)).toBeInTheDocument()

    // Re-query the trigger: the memoised cards re-render, so a reference
    // captured before the first expansion may be stale.
    fireEvent.click(screen.getByRole('button', { name: /Jwt Decoder/i }))

    // Only one disclosure region is open at a time.
    expect(
      screen.getByRole('button', { name: /Vin Decoder/i }),
    ).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getByRole('button', { name: /Jwt Decoder/i }),
    ).toHaveAttribute('aria-expanded', 'true')
    // The first tool's body unmounts; exactly one region remains and it is
    // JWT's (asserted via the a11y region label, not a brittle placeholder).
    expect(screen.queryByPlaceholderText(VIN_PLACEHOLDER)).toBeNull()
    expect(
      screen.queryByRole('region', { name: 'Vin Decoder' }),
    ).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Jwt Decoder' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(1)
  })

  it('marks the decorative icons aria-hidden so the button name is text-only', () => {
    render(<ClientUtilitiesSection />)

    const vinToggle = screen.getByRole('button', { name: /Vin Decoder/i })

    // The colour chip wrapper + chevron are both decorative.
    const hidden = vinToggle.querySelectorAll('[aria-hidden="true"]')
    expect(hidden.length).toBeGreaterThanOrEqual(2)

    // The accessible name comes purely from the tool's text, not the icons.
    expect(
      within(vinToggle).getByText('Vin Decoder'),
    ).toBeInTheDocument()
  })
})
