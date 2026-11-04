import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { deriveVehicleLabState, type VehicleLabState } from './vehicleLabState'
import VehicleSummary from './VehicleSummary'
import VehiclePartDetails from './VehiclePartDetails'
import type { VehicleReadingId } from './useVehicleReadings'

vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ settings: { unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar', decimal_precision: 1 } }) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string, options?: Record<string, string>) => fallback.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => options?.[key] ?? '') }),
}))

function Inspector({ state }: { state: VehicleLabState }) {
  const [selected, setSelected] = useState<VehicleReadingId | null>(null)
  return <>
    <VehicleSummary state={state} onSelect={setSelected} />
    <VehiclePartDetails selected={selected} state={state} onClose={() => setSelected(null)} />
  </>
}

it('retains all 27 unavailable readings and detail buttons without any telemetry', () => {
  render(<Inspector state={deriveVehicleLabState(null)} />)
  const summary = screen.getByRole('region', { name: 'Vehicle state' })
  expect(within(summary).getAllByText('Unavailable')).toHaveLength(27)
  expect(within(summary).getAllByRole('button')).toHaveLength(27)
  for (const name of ['Charging', 'Lock', 'Sentry', 'Climate', 'Cabin', 'Outside', 'Battery', 'Rated range', 'Gear', 'Speed']) {
    expect(within(summary).getByRole('button', { name: `Inspect ${name}` })).toBeVisible()
  }
})

it('opens real SI pressure details by keyboard, updates live values, and restores focus on Escape', async () => {
  const state = deriveVehicleLabState(null)
  state.tirePressurePa.FrontLeft = 300_000
  state.locked = false
  state.charging = true
  const { rerender } = render(<Inspector state={state} />)
  const trigger = screen.getByRole('button', { name: 'Inspect Front-left tire' })
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  expect(within(screen.getByRole('dialog', { name: 'Front-left tire' })).getByText('3.0 bar')).toBeVisible()
  rerender(<Inspector state={{ ...state, tirePressurePa: { ...state.tirePressurePa, FrontLeft: null } }} />)
  expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent('Unavailable')
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(screen.getByText('Unlocked')).toBeVisible()
  expect(screen.getByText('On')).toBeVisible()
})

it('shows open, partial, off and actual zero readings instead of inventing missing state', () => {
  const state = deriveVehicleLabState(null)
  state.doors.FrontLeft = 'open'
  state.windows.RearRight = 'partial'
  state.sentry = false
  state.climateOn = false
  state.insideTempC = 0
  state.batteryPercent = 0
  state.speedMps = 0
  render(<Inspector state={state} />)
  expect(screen.getByText('Open')).toBeVisible()
  expect(screen.getByText('Partial')).toBeVisible()
  expect(screen.getAllByText('Off')).toHaveLength(2)
  expect(screen.getByText('0.0°C')).toBeVisible()
  expect(screen.getByText('0.0%')).toBeVisible()
  expect(screen.getByText('0.0 km/h')).toBeVisible()
})
