import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import { ActionItem, type ActionSeverity } from '../ActionItem'

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
    ['info', 'bg-blue-500/10'],
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
    expect(root).toHaveClass('bg-blue-500/10')
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
})
