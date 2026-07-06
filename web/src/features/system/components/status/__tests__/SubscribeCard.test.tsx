/**
 * SubscribeCard — behaviour, routing-regression & a11y coverage.
 *
 * SubscribeCard is a static discoverability tile: it has no props, no network
 * and no settings dependency, so a bare render() wrapped in a MemoryRouter is
 * enough (its only child element is a react-router <Link>). `@testing-library/
 * user-event` is intentionally NOT a dependency of this repo, so interaction is
 * driven with `fireEvent`, matching the sibling status-card tests.
 *
 * The suite pins the bug the hardening pass fixed:
 *   - DEAD LINK: the "Browser push" tile pointed at /settings/notifications,
 *     which is not a registered route in App.tsx and fell through to the 404
 *     catch-all. The real browser-push surface is /notifications/browser.
 * …plus the a11y hardening (decorative icons hidden from AT, the card exposed
 * as a group programmatically labelled by its heading).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'

import { SubscribeCard } from '../SubscribeCard'

function renderCard() {
  return render(
    <MemoryRouter>
      <SubscribeCard />
    </MemoryRouter>,
  )
}

describe('SubscribeCard', () => {
  it('renders the heading and the self-hosted explainer copy', () => {
    renderCard()

    expect(
      screen.getByRole('heading', { level: 3, name: /Get notified about incidents/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Self-hosted: configure your own channels for status events.'),
    ).toBeInTheDocument()
  })

  it('renders exactly five channel tiles with their labels and descriptions', () => {
    renderCard()

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(5)

    for (const label of ['Email', 'Slack', 'Discord', 'Webhook', 'Browser push']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // "Webhook channel" is intentionally shared by the Slack and Discord tiles.
    expect(screen.getAllByText('Webhook channel')).toHaveLength(2)
    expect(screen.getByText('SMTP-based delivery')).toBeInTheDocument()
    expect(screen.getByText('Custom HTTP endpoint')).toBeInTheDocument()
    expect(screen.getByText('Opt-in PWA notifications')).toBeInTheDocument()
  })

  it('points the four provider tiles at /notifications/channels', () => {
    renderCard()

    const channelLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/notifications/channels')
    expect(channelLinks).toHaveLength(4)

    expect(screen.getByRole('link', { name: /Email/i })).toHaveAttribute(
      'href',
      '/notifications/channels',
    )
    // Matched by the Webhook tile's unique description ("Webhook channel" is
    // shared by the Slack/Discord tiles, so /Webhook/i alone is ambiguous).
    expect(screen.getByRole('link', { name: /Custom HTTP endpoint/i })).toHaveAttribute(
      'href',
      '/notifications/channels',
    )
  })

  it('routes "Browser push" to the real /notifications/browser surface (regression)', () => {
    // Pre-fix this pointed at /settings/notifications — a route that does not
    // exist in App.tsx and 404s through the catch-all.
    renderCard()

    const browserPush = screen.getByRole('link', { name: /Browser push/i })
    expect(browserPush).toHaveAttribute('href', '/notifications/browser')
    expect(browserPush).not.toHaveAttribute('href', '/settings/notifications')

    const browserLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/notifications/browser')
    expect(browserLinks).toHaveLength(1)
  })

  it('exposes the card as a group programmatically labelled by its heading', () => {
    renderCard()

    const group = screen.getByRole('group')
    const heading = screen.getByRole('heading', { level: 3 })

    expect(group).toHaveAttribute('data-testid', 'subscribe-card')
    // The label wiring must resolve to the heading element, not a stale id.
    expect(heading.id).toBeTruthy()
    expect(group).toHaveAttribute('aria-labelledby', heading.id)
    expect(group).toHaveAccessibleName('Get notified about incidents')
  })

  it('hides decorative icons from assistive tech and keeps them out of link names', () => {
    renderCard()

    // The heading's leading bell is purely decorative.
    const heading = screen.getByRole('heading', { level: 3 })
    const headingIcon = heading.querySelector('svg')
    expect(headingIcon).not.toBeNull()
    expect(headingIcon).toHaveAttribute('aria-hidden', 'true')

    // Each tile's leading glyph is hidden, so the accessible name is the
    // label + description text alone.
    const email = screen.getByRole('link', { name: /Email/i })
    const emailIcon = email.querySelector('svg')
    expect(emailIcon).toHaveAttribute('aria-hidden', 'true')
    expect(email).toHaveAccessibleName(/Email/i)
  })

  it('keeps every tile keyboard-focusable with a visible focus ring', () => {
    renderCard()

    const links = screen.getAllByRole('link')
    for (const link of links) {
      // react-router <Link> renders a real <a href>, which is natively focusable.
      expect(link).toHaveAttribute('href')
      expect(link.className).toContain('focus-visible:ring-2')
    }

    // Sanity: the link can receive focus in the jsdom a11y tree.
    const first = links[0]
    fireEvent.focus(first)
    expect(first).toHaveAttribute('href', '/notifications/channels')
  })
})
