import { describe, it, expect, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach } from 'vitest'

// The modal renders its copy through react-i18next; echo the English fallback
// so the shared <Modal> title assertions read against stable text without a
// provider (matches the sibling component tests' convention).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, defOrOpts?: unknown, maybeOpts?: unknown) => {
        let fallback: string | undefined
        let opts: Record<string, unknown> | undefined
        if (typeof defOrOpts === 'string') {
          fallback = defOrOpts
          opts = maybeOpts as Record<string, unknown> | undefined
        } else {
          opts = defOrOpts as Record<string, unknown> | undefined
        }
        let out = fallback ?? key
        if (opts) out = out.replace(/\{\{(\w+)\}\}/g, (_, name) => (opts?.[name] != null ? String(opts[name]) : ''))
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import SignalConfigModal from '../SignalConfigModal'

afterEach(() => {
  cleanup()
})

describe('SignalConfigModal viewport bounds', () => {
  it('keeps long configuration names and actions in the shared scroll-body/footer slots', () => {
    const signal = 'LongTelemetrySignalName'.repeat(20)
    const onClose = vi.fn()
    const onSubmit = vi.fn()
    render(
      <SignalConfigModal open onClose={onClose}
        categories={[{ category: 'Long category name '.repeat(10), fields: [signal] }]}
        initialSelected={[signal]} initialInterval={0} onSubmit={onSubmit} />,
    )
    expect(screen.getByText(signal)).toHaveClass('break-all', 'min-w-0')
    const submit = screen.getByRole('button', { name: 'Subscribe 1 Signals' })
    expect(submit.closest('[data-modal-footer]')).not.toBeNull()
    expect(submit.closest('[data-modal-scroll-body]')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Search signals' }).closest('[data-modal-scroll-body]')).not.toBeNull()
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toHaveFocus()
    submit.focus()
    fireEvent.keyDown(submit, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(submit).toHaveFocus()
    fireEvent.keyDown(submit, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // SignalConfigModal was a hand-rolled full-viewport
  // overlay that bypassed <Modal>'s viewport-bounds (max-h-[90vh] desktop /
  // max-h-[100dvh] mobile). It now renders inside the shared <Modal>, which
  // sets role="dialog" + aria-modal="true" via its wrapper. This test asserts
  // the migration: hand-rolled overlays don't produce a `role="dialog"`
  // element; <Modal> does.
  it('renders inside the shared <Modal> (role="dialog" present)', () => {
    render(
      <SignalConfigModal
        open
        onClose={() => {}}
        categories={[
          { category: 'Driving', fields: ['VehicleSpeed', 'Gear'] },
          { category: 'Charging', fields: ['ChargeState'] },
        ]}
        initialSelected={['VehicleSpeed']}
        initialInterval={10}
        onSubmit={() => {}}
      />,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('uses Modal\'s built-in title (no hand-rolled header)', () => {
    render(
      <SignalConfigModal
        open
        onClose={() => {}}
        categories={[{ category: 'Driving', fields: ['VehicleSpeed'] }]}
        initialSelected={[]}
        initialInterval={10}
        onSubmit={() => {}}
      />,
    )
    // Modal renders the title in an <h2> wired via aria-labelledby.
    expect(
      screen.getByRole('heading', { level: 2, name: /Fleet Telemetry Signal Configuration/i }),
    ).toBeInTheDocument()
  })

  it('renders nothing when open=false', () => {
    render(
      <SignalConfigModal
        open={false}
        onClose={() => {}}
        categories={[{ category: 'Driving', fields: ['VehicleSpeed'] }]}
        initialSelected={[]}
        initialInterval={10}
        onSubmit={() => {}}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
