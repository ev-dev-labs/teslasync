import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import SignalConfigModal from '../SignalConfigModal'

afterEach(() => {
  cleanup()
})

describe('SignalConfigModal viewport bounds', () => {
  // Phase-45 / Prompt 04: SignalConfigModal was a hand-rolled full-viewport
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
