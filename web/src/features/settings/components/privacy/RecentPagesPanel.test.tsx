/**
 * RecentPagesPanel contract.
 *
 * A presentational control the PrivacyPage feeds a live `count` and an
 * `onClear` callback. These tests lock in the behaviour that matters:
 *
 *   1. Header, description, pluralised counter, empty hint, and the clear
 *      button all render — the panel is never a blank card.
 *   2. `count === 0` disables the button and surfaces the empty hint.
 *   3. Clicking the enabled button fires `onClear` exactly once.
 *   4. Defensive clamping: negative / non-finite / fractional counts never
 *      leak into the label ("NaN entries stored") and never wrongly enable
 *      the destructive button.
 *   5. Accessibility: the counter is a polite live region, the icon-only
 *      affordances are decorative, and the button exposes a real name.
 *   6. Re-rendering with a fresh count flips the disabled/empty state.
 *
 * The component only consumes `useTranslation`; `react-i18next` is stubbed to
 * return the `defaultValue` argument with `{{count}}` interpolation, matching
 * the repo convention. No network, no providers required.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: unknown) => {
        if (typeof opts === 'string') return opts
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>
          let out = typeof o.defaultValue === 'string' ? o.defaultValue : key
          for (const [k, v] of Object.entries(o)) {
            out = out.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
          return out
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import RecentPagesPanelDefault, { RecentPagesPanel } from './RecentPagesPanel'

function renderPanel(count: number, onClear = vi.fn()) {
  const utils = render(<RecentPagesPanel count={count} onClear={onClear} />)
  return { onClear, ...utils }
}

describe('RecentPagesPanel — populated', () => {
  it('renders the header, description, pluralised counter, and clear button', () => {
    renderPanel(3)

    expect(screen.getByTestId('privacy-recent-section')).toBeInTheDocument()
    expect(screen.getByText('Recently viewed pages')).toBeInTheDocument()
    expect(
      screen.getByText(/Wipe the list of pages used by the status bar/),
    ).toBeInTheDocument()
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('3 entries stored')

    const button = screen.getByRole('button', { name: 'Clear recent pages' })
    expect(button).toBeEnabled()
  })

  it('does not render the empty hint when entries exist', () => {
    renderPanel(5)
    expect(
      screen.queryByText('Pages you visit will appear here for quick access.'),
    ).not.toBeInTheDocument()
  })

  it('fires onClear exactly once when the enabled button is clicked', () => {
    const { onClear } = renderPanel(2)
    fireEvent.click(screen.getByTestId('privacy-clear-recent-pages'))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe('RecentPagesPanel — empty', () => {
  it('disables the button and shows the empty hint at zero entries', () => {
    renderPanel(0)

    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('0 entries stored')
    expect(
      screen.getByText('Pages you visit will appear here for quick access.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeDisabled()
  })

  it('does not fire onClear when the disabled button is clicked', () => {
    const { onClear } = renderPanel(0)
    fireEvent.click(screen.getByTestId('privacy-clear-recent-pages'))
    expect(onClear).not.toHaveBeenCalled()
  })
})

describe('RecentPagesPanel — defensive count clamping', () => {
  it('treats a negative count as empty', () => {
    renderPanel(-4)
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('0 entries stored')
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeDisabled()
    expect(
      screen.getByText('Pages you visit will appear here for quick access.'),
    ).toBeInTheDocument()
  })

  it('renders 0 (not "NaN") for a non-finite count', () => {
    renderPanel(Number.NaN)
    const label = screen.getByTestId('privacy-recent-count')
    expect(label).toHaveTextContent('0 entries stored')
    expect(label.textContent).not.toContain('NaN')
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeDisabled()
  })

  it('floors a fractional count and keeps the button enabled', () => {
    renderPanel(4.9)
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('4 entries stored')
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeEnabled()
  })
})

describe('RecentPagesPanel — accessibility', () => {
  it('exposes the counter as a polite live region', () => {
    renderPanel(7)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('7 entries stored')
    expect(status).toHaveAttribute('aria-live', 'polite')
  })

  it('marks the icon-only affordances as decorative', () => {
    const { container } = renderPanel(1)
    // Both the History header icon and the Trash2 button icon must be hidden
    // from assistive tech so the button name stays "Clear recent pages".
    const hiddenIcons = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(hiddenIcons.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('button')).toHaveAccessibleName('Clear recent pages')
  })
})

describe('RecentPagesPanel — reactivity & exports', () => {
  it('flips the disabled/empty state when the count changes', () => {
    const { rerender } = renderPanel(3)
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeEnabled()
    expect(
      screen.queryByText('Pages you visit will appear here for quick access.'),
    ).not.toBeInTheDocument()

    rerender(<RecentPagesPanel count={0} onClear={vi.fn()} />)
    expect(screen.getByTestId('privacy-clear-recent-pages')).toBeDisabled()
    expect(screen.getByTestId('privacy-recent-count')).toHaveTextContent('0 entries stored')
    expect(
      screen.getByText('Pages you visit will appear here for quick access.'),
    ).toBeInTheDocument()
  })

  it('exports the same component as the default and the named binding', () => {
    expect(RecentPagesPanelDefault).toBe(RecentPagesPanel)
  })
})
