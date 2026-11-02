import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { deriveVehicleLabState } from './vehicleLabState'
import VehicleReadings from './VehicleReadings'
import VehicleTireLabels from './VehicleTireLabels'

const settings = vi.hoisted(() => ({ unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar', decimal_precision: 1, locale: 'en-US' }))
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ settings }) }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string, opts?: { value: string }) => opts ? fallback.replace('{{value}}', opts.value) : fallback }),
}))
vi.mock('@react-three/drei/web/Html', () => ({ Html: ({ children }: { children: ReactNode }) => <div>{children}</div> }))

beforeEach(() => {
  settings.unit_of_length = 'km'
  settings.unit_of_temp = 'C'
  settings.unit_of_pressure = 'bar'
})

it('formats actual SI range and temperatures in user preferences while preserving missing and zero readings', () => {
  const state = { ...deriveVehicleLabState(null), rangeM: 1609.344, insideTempC: 0, batteryPercent: 0 }
  settings.unit_of_length = 'mi'
  settings.unit_of_temp = 'F'
  render(<VehicleReadings state={state} />)
  expect(screen.getByText('1.0 mi')).toBeInTheDocument()
  expect(screen.getByText('32.0°F')).toBeInTheDocument()
  expect(screen.getByText('0.0%')).toBeInTheDocument()
  expect(screen.getByText('Unavailable')).toBeInTheDocument()
})

it('bridges Pa through the shared pressure formatter and only warns outside the inclusive existing band', () => {
  const state = deriveVehicleLabState(null)
  state.tirePressurePa = { FrontLeft: 250_000, FrontRight: 350_000, RearLeft: 249_999, RearRight: null }
  render(<VehicleTireLabels state={state} />)
  expect(screen.getAllByText('2.5 bar')).toHaveLength(2)
  expect(screen.getByText('3.5 bar')).toBeInTheDocument()
  expect(screen.getAllByText('Outside normal band')).toHaveLength(1)
  expect(screen.getByText('Unavailable')).toBeInTheDocument()
})

it('converts real pressure to psi and leaves all missing corners without a warning', () => {
  const state = deriveVehicleLabState(null)
  settings.unit_of_pressure = 'psi'
  state.tirePressurePa.FrontLeft = 300_000
  render(<VehicleTireLabels state={state} />)
  expect(screen.getByText('43.5 psi')).toBeInTheDocument()
  expect(screen.getAllByText('Unavailable')).toHaveLength(3)
  expect(screen.queryByText('Outside normal band')).not.toBeInTheDocument()
})

it('marks a high tire pressure without confusing unavailable pressure with a warning', () => {
  const state = deriveVehicleLabState(null)
  state.tirePressurePa.RearRight = 350_001
  render(<VehicleTireLabels state={state} />)
  expect(screen.getAllByText('Outside normal band')).toHaveLength(1)
  expect(screen.getAllByText('Unavailable')).toHaveLength(3)
})
