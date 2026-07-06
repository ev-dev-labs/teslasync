/**
 * SafetySettingCard — behavioural contract for a single safety-setting tile.
 *
 * SafetySettingCard is a pure, presentational leaf: it takes already-translated
 * strings + a decorative icon and renders one `<li>` bento tile (accent icon,
 * h3 title, status chip, description, docs deep-link). It performs no network
 * or context access, so these tests render it bare — no QueryClient / Router /
 * i18n provider is required.
 *
 * Coverage goes past a smoke render:
 *   • the deterministic `safety-settings-row-<key>` / `safety-settings-value-<key>`
 *     test-ID contract the AI-OFF static-help suite asserts against;
 *   • the `accent` → neon-token branch (default cyan, an explicit accent, and
 *     the out-of-range fallback that must NOT crash);
 *   • the `valueVariant` → Badge colour branch (default `info` vs an override);
 *   • the empty-value → em-dash guard (a status chip is never blank);
 *   • the docs anchor's href / target / rel / accessible-name wiring;
 *   • a11y: h3 heading role, the icon wrapper is `aria-hidden`, the decorative
 *     ExternalLink glyph is hidden, and the link is keyboard-focusable with a
 *     visible focus ring.
 *
 * user-event is not installed in this repo, so keyboard focus is driven with
 * the native `.focus()` DOM API (matching the sibling settings tests).
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { NeonColor } from '@/lib/tokens'
import {
  SafetySettingCard,
  type SafetySettingCardProps,
} from './SafetySettingCard'

function baseProps(
  overrides: Partial<SafetySettingCardProps> = {},
): SafetySettingCardProps {
  return {
    testKey: 'quietHoursEnabled',
    icon: <svg data-testid="card-icon" />,
    title: 'Quiet hours',
    value: 'On',
    description: 'When ON, TeslaSync defers non-critical notifications.',
    docsHref: '/docs/notifications/quiet-hours.md',
    docsLabel: 'Docs',
    docsAriaLabel: 'Open documentation for Quiet hours',
    ...overrides,
  }
}

function renderCard(overrides: Partial<SafetySettingCardProps> = {}) {
  return render(<SafetySettingCard {...baseProps(overrides)} />)
}

describe('SafetySettingCard — content + structure', () => {
  it('renders the title as an h3, the value chip, and the description paragraph', () => {
    renderCard()

    const heading = screen.getByRole('heading', { level: 3, name: 'Quiet hours' })
    expect(heading).toBeInTheDocument()

    const chip = screen.getByTestId('safety-settings-value-quietHoursEnabled')
    expect(chip).toHaveTextContent('On')

    const description = screen.getByText(
      'When ON, TeslaSync defers non-critical notifications.',
    )
    expect(description.tagName).toBe('P')
  })

  it('composes as a list item so it nests inside a semantic <ul>', () => {
    renderCard()
    const row = screen.getByTestId('safety-settings-row-quietHoursEnabled')
    expect(row.tagName).toBe('LI')
  })

  it('derives both deterministic test IDs verbatim from testKey', () => {
    renderCard({ testKey: 'apiSuspended', title: 'API kill-switch', value: 'Active' })

    expect(
      screen.getByTestId('safety-settings-row-apiSuspended'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('safety-settings-value-apiSuspended'),
    ).toHaveTextContent('Active')
    // The original key's IDs must NOT leak when a different key is supplied.
    expect(
      screen.queryByTestId('safety-settings-row-quietHoursEnabled'),
    ).not.toBeInTheDocument()
  })
})

describe('SafetySettingCard — value chip', () => {
  it('defaults to the info Badge variant', () => {
    renderCard()
    const chip = screen.getByTestId('safety-settings-value-quietHoursEnabled')
    // info → blue Badge palette (see components/ui/Badge variants map).
    expect(chip.className).toContain('text-blue-800')
    expect(chip.className).not.toContain('text-red-800')
  })

  it('applies an explicit valueVariant to the chip colour', () => {
    renderCard({ valueVariant: 'danger', value: 'Suspended' })
    const chip = screen.getByTestId('safety-settings-value-quietHoursEnabled')
    expect(chip).toHaveTextContent('Suspended')
    expect(chip.className).toContain('text-red-800')
  })

  it('falls back to an em-dash so the status chip is never blank', () => {
    renderCard({ value: '' })
    const chip = screen.getByTestId('safety-settings-value-quietHoursEnabled')
    expect(chip).toHaveTextContent('—')
  })
})

describe('SafetySettingCard — accent branch', () => {
  it('uses the cyan neon tokens by default', () => {
    renderCard()
    const wrapper = screen.getByTestId('card-icon').parentElement
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toContain('text-cyan-300')
    expect(wrapper?.className).toContain('bg-neon-cyan/10')
  })

  it('maps an explicit accent onto its toned token set', () => {
    renderCard({ accent: 'red' })
    const wrapper = screen.getByTestId('card-icon').parentElement
    expect(wrapper?.className).toContain('text-rose-300')
    expect(wrapper?.className).toContain('bg-neon-red/10')
    expect(wrapper?.className).not.toContain('text-cyan-300')
  })

  it('degrades an out-of-range accent to the cyan fallback instead of crashing', () => {
    const mount = () =>
      renderCard({ accent: 'chartreuse' as unknown as NeonColor })
    expect(mount).not.toThrow()

    const wrapper = screen.getByTestId('card-icon').parentElement
    expect(wrapper?.className).toContain('text-cyan-300')
  })
})

describe('SafetySettingCard — docs anchor + a11y', () => {
  it('wires the docs link href, new-tab target, rel, and accessible name', () => {
    renderCard()
    const link = screen.getByRole('link', {
      name: 'Open documentation for Quiet hours',
    })
    expect(link).toHaveAttribute('href', '/docs/notifications/quiet-hours.md')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link).toHaveTextContent('Docs')
  })

  it('hides the decorative icons from the accessibility tree', () => {
    renderCard()

    // The leading accent glyph is wrapped in an aria-hidden span.
    const iconWrapper = screen.getByTestId('card-icon').parentElement
    expect(iconWrapper).toHaveAttribute('aria-hidden', 'true')

    // The ExternalLink glyph inside the docs link is aria-hidden too, so the
    // link's accessible name is just the docsAriaLabel, not "graphic".
    const link = screen.getByRole('link', {
      name: 'Open documentation for Quiet hours',
    })
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('exposes a keyboard-focusable docs link with a visible focus ring', () => {
    renderCard()
    const link = screen.getByRole('link', {
      name: 'Open documentation for Quiet hours',
    })

    link.focus()
    expect(link).toHaveFocus()
    expect(link.className).toContain('focus-visible:ring-cyan-400/40')
  })
})
