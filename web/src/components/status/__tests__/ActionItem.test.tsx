import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { ActionItem, type ActionSeverity } from '../ActionItem'
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs'

// Deterministic i18n: `t(key, fallback)` returns the English default string
// (mirrors the sibling devtools tests). This pins the external-link "opens in
// a new tab" screen-reader hint regardless of i18n init state in jsdom, while
// keeping `Trans`, `initReactI18next`, … intact for transitive consumers.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

function withRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('ActionItem', () => {
  it('renders the title and, when supplied, the description', () => {
    withRouter(
      <ActionItem
        severity="warn"
        title="Update available"
        description="v1.2.0 → v1.3.0"
      />,
    )
    expect(screen.getByText('Update available')).toBeInTheDocument()
    expect(screen.getByText('v1.2.0 → v1.3.0')).toBeInTheDocument()
  })

  it('omits the description line when no description is provided', () => {
    withRouter(<ActionItem severity="info" title="Just a title" />)
    expect(screen.getByText('Just a title')).toBeInTheDocument()
    expect(screen.queryByText('v1.2.0 → v1.3.0')).not.toBeInTheDocument()
  })

  it('accepts a ReactNode description', () => {
    withRouter(
      <ActionItem
        severity="info"
        title="Rich"
        description={<span data-testid="rich-desc">rich node</span>}
      />,
    )
    expect(screen.getByTestId('rich-desc')).toHaveTextContent('rich node')
  })

  it.each([
    ['info', 'bg-status-info/10'],
    ['warn', 'bg-amber-500/10'],
    ['error', 'bg-red-500/10'],
  ] as const)(
    'applies the %s severity styling and hides the decorative glyph',
    (severity, bgClass) => {
      const { container } = withRouter(
        <ActionItem severity={severity} title="Row" />,
      )
      const root = container.firstElementChild as HTMLElement
      expect(root).toHaveClass(bgClass)
      expect(root).toHaveAttribute('data-app-feedback-kind', 'notice')
      expect(root).toHaveAttribute('data-app-tone', severity === 'warn' ? 'warning' : severity === 'error' ? 'danger' : 'info')
      // The severity glyph is purely decorative — hidden from assistive tech.
      const icon = root.querySelector('svg')
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    },
  )

  it('falls back to the info styling for an unknown severity without crashing', () => {
    const { container } = withRouter(
      <ActionItem severity={'bogus' as ActionSeverity} title="Weird" />,
    )
    expect(screen.getByText('Weird')).toBeInTheDocument()
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('bg-status-info/10')
    expect(root).toHaveAttribute('data-app-tone', 'info')
  })

  it('renders an internal CTA as a router link — same tab, no external hint', () => {
    withRouter(
      <ActionItem
        severity="warn"
        title="Re-auth"
        cta={{ label: 'Reconnect', to: '/tesla-account' }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Reconnect' })
    expect(link).toHaveAttribute('href', '/tesla-account')
    expect(link).toHaveAttribute('data-app-part', 'button')
    expect(link).toHaveAttribute('data-app-variant', 'ghost')
    expect(link).not.toHaveAttribute('target', '_blank')
    expect(link).not.toHaveAccessibleName(/opens in a new tab/i)
  })

  it('renders an external CTA in a new tab with a safe rel and an SR hint', () => {
    withRouter(
      <ActionItem
        severity="error"
        title="Docs"
        cta={{
          label: 'Open docs',
          to: 'https://tesla.example/docs',
          external: true,
        }}
      />,
    )
    const link = screen.getByRole('link', { name: /Open docs/ })
    expect(link).toHaveAttribute('href', 'https://tesla.example/docs')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('data-app-variant', 'ghost')
    // WCAG G201 — external navigation is announced to screen readers.
    expect(link).toHaveAccessibleName(/opens in a new tab/i)
  })

  it('falls back to a button that fires onClick when no route is given', () => {
    const onClick = vi.fn()
    withRouter(
      <ActionItem
        severity="warn"
        title="Backup"
        cta={{ label: 'Run backup', onClick }}
      />,
    )
    // Accessible name is exactly the label — the chevron adds no SR noise.
    const button = screen.getByRole('button', { name: 'Run backup' })
    expect(screen.queryByRole('link')).toBeNull()
    expect(button).toHaveAttribute('data-app-part', 'button')
    expect(button).toHaveAttribute('data-app-variant', 'ghost')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders no interactive CTA when neither `to` nor `onClick` is given', () => {
    withRouter(
      <ActionItem severity="info" title="Static" cta={{ label: 'noop' }} />,
    )
    expect(screen.getByText('Static')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('noop')).toBeNull()
  })

  it('activates real notice composition only through the nearest complete profile (source selectors, not mounted acceptance)', () => {
    const rules: postcss.Rule[] = []
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
      .walkRules(rule => { rules.push(rule) })
    const { container } = withRouter(
      <ActionItem severity="error" title="Tesla token expired" description={<strong>Sign in again</strong>}
        cta={{ label: 'Reconnect', to: '/tesla-account' }} />,
    )
    container.setAttribute('data-app-design-preview', '')
    const row = container.firstElementChild!
    const noticeRules = rules.filter(rule => rule.selector.includes('[data-app-feedback-kind="notice"]')
      && rule.nodes.some(node => node.type === 'decl' && node.prop === 'display' && node.value === 'grid'))
    expect(noticeRules.some(rule => row.matches(rule.selector))).toBe(false)
    const packs = Object.keys(APPLICATION_DESIGNS) as Array<Parameters<typeof getAppDesignAttributes>[0]>
    for (const pack of packs) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value)
      const release = observeAppDesignScopes(container)
      try {
        expect(noticeRules.some(rule => row.matches(rule.selector)), pack).toBe(true)
        expect(row.querySelector(':scope > [data-app-part~="feedback-icon"]')).toHaveAttribute('aria-hidden', 'true')
        expect(row.querySelector(':scope > [data-app-part~="feedback-content"] [data-app-part~="feedback-title"]')).toHaveTextContent('Tesla token expired')
        expect(row.querySelector('[data-app-part~="feedback-message"] strong')).toHaveTextContent('Sign in again')
        expect(row.querySelector(':scope > [data-app-part~="feedback-actions"] a')).toBe(screen.getByRole('link'))
      } finally { release() }
    }
    container.removeAttribute('data-app-feedback')
    const release = observeAppDesignScopes(container)
    try { expect(noticeRules.some(rule => row.matches(rule.selector))).toBe(false) }
    finally { release() }
  })
})
