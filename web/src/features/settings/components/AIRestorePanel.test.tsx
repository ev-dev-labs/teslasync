/**
 * AIRestorePanel contract.
 *
 * The panel is a pure, prop-driven surface (no hooks / no network). It
 * asks the user whether to re-enable a previously-archived Helix
 * feature selection (ADR-015 §I7 — restore is never silent). These
 * tests lock in:
 *
 *   1. The scaffold always renders: an announced (role="alert") panel
 *      with a title, description, and BOTH the confirm/decline actions
 *      reachable by their accessible names.
 *   2. `previewLabels` behaviour, exercised through the rendered list:
 *      only enabled entries appear, known ids resolve to their
 *      translated display name, unknown ids fall back to the raw id,
 *      and an all-disabled map renders the panel WITHOUT a list (never
 *      a blank/absent panel).
 *   3. The null-safety guard: a missing archive map is tolerated
 *      instead of throwing from `Object.entries(undefined)`.
 *   4. Rows are keyed by feature id, so two features that resolve to
 *      the same display label do not collide as React keys.
 *   5. onConfirm / onDecline fire exactly once, and only on the
 *      matching button.
 *
 * `react-i18next` is stubbed so `t(key, fallback)` returns the
 * fallback (mirroring a missing translation key), which lets the
 * assertions target the English defaults and the AI_FEATURES display
 * names. The stub is made controllable via `vi.hoisted` so one test
 * can force duplicate labels.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import type { ReactNode } from 'react'

const i18nState = vi.hoisted(() => ({
  // Default: echo the caller-provided fallback, exactly as production
  // i18n does when a key is missing.
  translate: (_key: string, fallback?: string): string => fallback ?? _key,
}))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        i18nState.translate(
          key,
          typeof fallback === 'string' ? fallback : undefined,
        ),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { AIRestorePanel } from './AIRestorePanel'
import { AI_FEATURES } from '@/ai/features'

function renderPanel(archived: Record<string, boolean>) {
  const onConfirm = vi.fn()
  const onDecline = vi.fn()
  const utils = render(
    <AIRestorePanel
      archived={archived}
      onConfirm={onConfirm}
      onDecline={onDecline}
    />,
  )
  return { ...utils, onConfirm, onDecline }
}

beforeEach(() => {
  // Reset the translate stub so the duplicate-label test cannot leak.
  i18nState.translate = (_key: string, fallback?: string) => fallback ?? _key
})

describe('AIRestorePanel', () => {
  it('renders an announced panel with a title, description and both actions', () => {
    const { onConfirm, onDecline } = renderPanel({ 'auto-trip-naming': true })

    const panel = screen.getByTestId('ai-restore-panel')
    expect(panel).toBeInTheDocument()
    // role="alert" so assistive tech announces the prompt on appearance.
    expect(panel).toHaveAttribute('role', 'alert')

    expect(
      screen.getByRole('heading', {
        name: /restore previous helix selection/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/you previously had these features enabled/i),
    ).toBeInTheDocument()

    // Both controls are reachable by their visible accessible name.
    expect(
      screen.getByRole('button', { name: /restore selection/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /no thanks/i }),
    ).toBeInTheDocument()

    // Nothing is invoked merely by mounting.
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onDecline).not.toHaveBeenCalled()
  })

  it('lists only enabled archived features, using their display names', () => {
    renderPanel({ 'auto-trip-naming': true, 'drive-coaching': false })

    const list = screen.getByRole('list')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent(AI_FEATURES['auto-trip-naming'].name)

    // The disabled entry must not surface at all.
    expect(
      within(list).queryByText(AI_FEATURES['drive-coaching'].name),
    ).toBeNull()
  })

  it('falls back to the raw id when a feature is no longer known', () => {
    renderPanel({ 'ghost-feature-from-the-past': true })

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('ghost-feature-from-the-past')
  })

  it('renders every enabled entry and skips the disabled ones', () => {
    renderPanel({
      'auto-trip-naming': true,
      'drive-coaching': true,
      'nl-search': false,
    })

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    const text = items.map((li) => li.textContent)
    expect(text).toContain(AI_FEATURES['auto-trip-naming'].name)
    expect(text).toContain(AI_FEATURES['drive-coaching'].name)
    expect(text).not.toContain(AI_FEATURES['nl-search'].name)
  })

  it('shows the prompt without a list when nothing is enabled', () => {
    renderPanel({ 'auto-trip-naming': false })

    // Panel + primary action still render — never a blank/absent panel.
    expect(screen.getByTestId('ai-restore-panel')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /restore selection/i }),
    ).toBeInTheDocument()

    // ...but the feature list is omitted entirely.
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('tolerates a missing archive map without crashing', () => {
    expect(() =>
      render(
        <AIRestorePanel
          archived={undefined as unknown as Record<string, boolean>}
          onConfirm={vi.fn()}
          onDecline={vi.fn()}
        />,
      ),
    ).not.toThrow()

    expect(screen.getByTestId('ai-restore-panel')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('keys rows by feature id so duplicate labels do not collide', () => {
    // Force every feature label to resolve to the same string.
    i18nState.translate = () => 'Identical Label'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      renderPanel({ 'auto-trip-naming': true, 'drive-coaching': true })

      // Both enabled features still render as distinct rows...
      expect(screen.getAllByRole('listitem')).toHaveLength(2)

      // ...and React never warns about a duplicate key — which it would
      // if the rows were keyed on the now-identical display label.
      const dupeKeyWarning = errorSpy.mock.calls.some((call) =>
        String(call[0] ?? '')
          .toLowerCase()
          .includes('same key'),
      )
      expect(dupeKeyWarning).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('invokes onConfirm (only) when the restore button is clicked', () => {
    const { onConfirm, onDecline } = renderPanel({ 'auto-trip-naming': true })

    fireEvent.click(screen.getByTestId('ai-restore-confirm'))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onDecline).not.toHaveBeenCalled()
  })

  it('invokes onDecline (only) when the dismiss button is clicked', () => {
    const { onConfirm, onDecline } = renderPanel({ 'auto-trip-naming': true })

    fireEvent.click(screen.getByTestId('ai-restore-decline'))

    expect(onDecline).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
