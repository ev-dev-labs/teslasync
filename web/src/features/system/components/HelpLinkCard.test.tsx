// Behavioural coverage for HelpLinkCard — the single curated Help
// destination card rendered by HelpPage.
//
// The card is a full-surface, fully-clickable <Link> wrapping a
// GlassPanel. These tests pin the load-bearing contract the sibling
// integration test (TestRagHelpAIOffHidesAssistantAndDocsLinksWork)
// depends on: a real anchor with the exact `to` href and the stable
// `help-baseline-link-<id>` test id. Beyond that they exercise the
// accent/i18n/a11y facets and the malformed-data hardening path.
//
// react-i18next is mocked (not the real runtime) so `t` returns the
// fallback deterministically AND we can assert the exact i18n key +
// fallback each label is wired to. Nothing here touches the network.

import type { ReactNode } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import type { LucideIcon } from 'lucide-react'

import { HelpLinkCard, type HelpLink } from './HelpLinkCard'

const { mockT } = vi.hoisted(() => ({
  // Mirror react-i18next's `t(key, defaultValue)` contract: return the
  // fallback so the rendered copy is the fixture's fallback string, while
  // still recording the key so tests can prove the i18n wiring.
  mockT: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
  Trans: ({ children }: { children?: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

// A stub Lucide icon that surfaces the props the card forwards (className +
// aria-hidden) so the tests can assert the glyph is decorative.
const StubIcon = ((props: { className?: string }) => (
  <svg data-testid="accent-icon" {...props} />
)) as unknown as LucideIcon

function makeLink(overrides: Partial<HelpLink> = {}): HelpLink {
  return {
    id: 'docs',
    to: '/docs/status-api',
    Icon: StubIcon,
    accent: 'purple',
    titleKey: 'help.links.docs.title',
    titleFallback: 'Docs Title',
    descKey: 'help.links.docs.desc',
    descFallback: 'Read the API reference guide.',
    ...overrides,
  }
}

function renderCard(link: HelpLink, initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <HelpLinkCard link={link} />
    </MemoryRouter>,
  )
}

// Renders the live location so a click can be proven to actually navigate.
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="loc">{location.pathname}</div>
}

beforeEach(() => {
  mockT.mockClear()
})
afterEach(() => cleanup())

describe('HelpLinkCard', () => {
  it('renders a single anchor carrying the destination href and the stable test id', () => {
    renderCard(makeLink({ id: 'docs-status-api', to: '/docs/status-api' }))

    const anchor = screen.getByTestId('help-baseline-link-docs-status-api')
    expect(anchor.tagName).toBe('A')
    expect(anchor).toHaveAttribute('href', '/docs/status-api')
    // Exactly one link — the whole card is the target, not a nested control.
    expect(screen.getByRole('link')).toBe(anchor)
  })

  it('renders the title and description through i18n with the exact keys + fallbacks', () => {
    renderCard(makeLink())

    expect(screen.getByText('Docs Title')).toBeInTheDocument()
    expect(screen.getByText('Read the API reference guide.')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('help.links.docs.title', 'Docs Title')
    expect(mockT).toHaveBeenCalledWith('help.links.docs.desc', 'Read the API reference guide.')
  })

  it('renders the accent glyph and a trailing arrow, both hidden from assistive tech', () => {
    const { container } = renderCard(makeLink())

    const glyph = screen.getByTestId('accent-icon')
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
    // Two decorative glyphs total: the accent icon + the affordance arrow.
    // Neither should be exposed to screen readers (the link text carries meaning).
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2)
  })

  it('applies the accent hue to the icon chip only, and varies per accent', () => {
    const purple = renderCard(makeLink({ accent: 'purple' }))
    const purpleChip = screen.getByTestId('accent-icon').parentElement as HTMLElement
    expect(purpleChip.className).toContain('bg-[var(--semantic-purple-bg)]')
    // The body copy must NOT carry a neon text color — accent is chip-only.
    expect(screen.getByText('Read the API reference guide.').className).not.toMatch(/text-neon-/)
    purple.unmount()

    renderCard(makeLink({ accent: 'green' }))
    const greenChip = screen.getByTestId('accent-icon').parentElement as HTMLElement
    expect(greenChip.className).toContain('bg-[var(--semantic-success-bg)]')
  })

  it('is a keyboard-focusable target with a semantic focus outline', () => {
    renderCard(makeLink())

    const anchor = screen.getByRole('link')
    expect(anchor).toHaveClass(
      'focus-visible:outline',
      'focus-visible:outline-2',
      'focus-visible:outline-offset-2',
      'focus-visible:outline-[var(--focus-ring)]',
      'forced-colors:focus-visible:outline-[Highlight]',
    )
    expect(anchor.className).not.toMatch(/(?:^|\s)(?:focus:|focus-visible:)(?:outline-none|ring-\S+)/)
    anchor.focus()
    expect(anchor).toHaveFocus()
  })

  it('derives the accessible name from the visible title and description', () => {
    renderCard(makeLink())

    const anchor = screen.getByRole('link', { name: /Docs Title/ })
    expect(anchor).toBeInTheDocument()
    expect(anchor).toHaveAccessibleName(/Read the API reference guide/)
  })

  it('actually navigates to the destination route when the card is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/help']}>
        <HelpLinkCard link={makeLink({ id: 'chatbot', to: '/chatbot' })} />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('loc')).toHaveTextContent('/help')
    fireEvent.click(screen.getByTestId('help-baseline-link-chatbot'))
    expect(screen.getByTestId('loc')).toHaveTextContent('/chatbot')
  })

  it('degrades gracefully when the icon reference is missing (malformed link data)', () => {
    // A config-driven HelpLink could arrive with an undefined Icon. The card
    // must skip the glyph — never throw "Element type is invalid" and blank
    // the whole Help page.
    const { container } = renderCard(
      makeLink({ id: 'broken', Icon: undefined as unknown as LucideIcon }),
    )

    expect(screen.getByTestId('help-baseline-link-broken')).toBeInTheDocument()
    expect(screen.getByText('Docs Title')).toBeInTheDocument()
    expect(screen.queryByTestId('accent-icon')).toBeNull()
    // Only the decorative arrow survives; the accent glyph was skipped, not thrown.
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
  })

  it('retains native tab order and Enter navigation without a disabled or button role', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/help']}>
        <HelpLinkCard link={makeLink({ id: 'docs' })} />
        <HelpLinkCard link={makeLink({ id: 'chatbot', to: '/chatbot' })} />
        <LocationProbe />
      </MemoryRouter>,
    )
    const docs = screen.getByTestId('help-baseline-link-docs')
    const chatbot = screen.getByTestId('help-baseline-link-chatbot')

    expect(docs).not.toHaveAttribute('tabindex')
    expect(docs).not.toHaveAttribute('disabled')
    expect(docs).not.toHaveAttribute('aria-disabled')
    expect(docs).not.toHaveAttribute('role')
    await user.tab()
    expect(docs).toHaveFocus()
    await user.tab()
    expect(chatbot).toHaveFocus()
    await user.tab({ shift: true })
    expect(docs).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('loc')).toHaveTextContent('/docs/status-api')
  })

  it.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const)(
    'leaves %s modified clicks to native navigation',
    (modifier) => {
      render(
        <MemoryRouter initialEntries={['/help']}>
          <HelpLinkCard link={makeLink()} />
          <LocationProbe />
        </MemoryRouter>,
      )
      const anchor = screen.getByRole('link')

      expect(fireEvent.click(anchor, { [modifier]: true })).toBe(true)
      expect(anchor).toHaveAttribute('href', '/docs/status-api')
      expect(screen.getByTestId('loc')).toHaveTextContent('/help')
    },
  )

  it('preserves destination query and fragment, card geometry and full visible content', () => {
    const { container } = renderCard(makeLink({ to: '/docs/status-api?view=all#health' }))
    const anchor = screen.getByRole('link')

    expect(anchor).toHaveAttribute('href', '/docs/status-api?view=all#health')
    expect(anchor).toHaveClass('group', 'block', 'h-full', 'rounded-xl')
    expect(anchor.firstElementChild).toHaveClass('flex', 'h-full', 'min-h-28', 'flex-col', 'gap-3', 'p-4', 'sm:p-5')
    expect(anchor).toHaveAccessibleName('Docs Title Read the API reference guide.')
    expect(container.querySelectorAll('a')).toHaveLength(1)
    expect(container.querySelectorAll('button, input, select, textarea, [tabindex]')).toHaveLength(0)
  })
})
