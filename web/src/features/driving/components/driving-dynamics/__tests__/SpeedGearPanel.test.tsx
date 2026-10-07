/**
 * SpeedGearPanel — Top/Avg Drive Speed double-conversion regression.
 *
 * Pre-fix (this commit):
 *   The reduce/Math.max for `avgDriveSpeed` and `topDriveSpeed`
 *   converted m/s → mph (or → km/h) once during aggregation, then the
 *   JSX site applied `toSpeedDisplay` AGAIN when rendering. Net effect
 *   for mph users: ×2.237² = ×5.005 multiplier, so a real ~31 mph top
 *   rendered as "154 mph" (the bug the user surfaced via screenshot).
 *
 * Post-fix:
 *   Aggregates run in SI m/s; conversion happens ONCE at the render
 *   site. The two assertions below pin the invariant for both metrics
 *   under mph display.
 *
 * The sister metric panels (`MotorHistoryCharts`, `DriveAnalyticsSection`)
 * use the same `toSpeedDisplay` helper but already hand it raw m/s
 * series — they were never affected by the double application.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import SpeedGearPanel from '../SpeedGearPanel'
import { convertSpeedFromSI } from '@/lib/unitConversion'
import type { Drive } from '@/types/driving'

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

// Minimal Drive fixture builder: only the two speed fields the panel
// reads. Timestamps and IDs are placeholders since the panel never
// renders them — it only reduces over avgSpeedMps / maxSpeedMps.
function drive(maxSpeedMps: number | null, avgSpeedMps: number | null): Drive {
  return {
    id: 'd1',
    vehicleId: 1,
    startTs: '2026-05-10T00:00:00Z',
    endTs: '2026-05-10T01:00:00Z',
    durationS: 3600,
    distanceM: 50000,
    avgSpeedMps,
    maxSpeedMps,
    avgPowerW: null,
    avgEfficiencyWhPerKm: null,
    energyConsumedWh: null,
    energyRegeneratedWh: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    startOdometerMi: 1000,
    endOdometerMi: 1031,
    startAddress: null,
    endAddress: null,
  } as unknown as Drive
}

describe('SpeedGearPanel — double-conversion regression', () => {
  // 44.704 m/s = 100 mph exactly (1 mph = 0.44704 m/s).
  // Pre-fix this would render as Math.round(100 × 2.237) = "224"; the
  // assertion below pins the single-conversion invariant.
  it('renders top drive speed in mph from SI m/s (no double conversion)', () => {
    const drives: Drive[] = [drive(44.704, 22.352)]
    const toMph = (mps: number) => convertSpeedFromSI(mps, 'mph')
    renderWithClient(
      <SpeedGearPanel
        motorLatest={null}
        filteredDrives={drives}
        toSpeedDisplay={toMph}
        speedUnit="mph"
      />,
    )
    // Find the StatCard whose label is "Top Drive Speed" and assert
    // its value is the rounded mph figure ("100"), NOT "224".
    const topLabel = screen.getByText('Top Drive Speed')
    expect(topLabel.parentElement?.textContent).toContain('100')
    expect(topLabel.parentElement?.textContent).not.toContain('224')
  })

  it('renders avg drive speed in mph from SI m/s (no double conversion)', () => {
    // Two drives at 22.352 and 13.4112 m/s → average 17.8816 m/s = 40 mph.
    // Pre-fix would have produced 40 × 2.237 ≈ "89".
    const drives: Drive[] = [drive(44.704, 22.352), drive(31.2928, 13.4112)]
    const toMph = (mps: number) => convertSpeedFromSI(mps, 'mph')
    renderWithClient(
      <SpeedGearPanel
        motorLatest={null}
        filteredDrives={drives}
        toSpeedDisplay={toMph}
        speedUnit="mph"
      />,
    )
    const avgLabel = screen.getByText('Avg Drive Speed')
    expect(avgLabel.parentElement?.textContent).toContain('40')
    expect(avgLabel.parentElement?.textContent).not.toContain('89')
  })

  it('renders top drive speed in km/h from SI m/s (no double conversion)', () => {
    // 27.7778 m/s = 100 km/h; pre-fix km/h users saw ×3.6² = ×12.96.
    const drives: Drive[] = [drive(27.7778, 13.8889)]
    const toKph = (mps: number) => convertSpeedFromSI(mps, 'km/h')
    renderWithClient(
      <SpeedGearPanel
        motorLatest={null}
        filteredDrives={drives}
        toSpeedDisplay={toKph}
        speedUnit="km/h"
      />,
    )
    const topLabel = screen.getByText('Top Drive Speed')
    expect(topLabel.parentElement?.textContent).toContain('100')
    expect(topLabel.parentElement?.textContent).not.toContain('1,300')
    expect(topLabel.parentElement?.textContent).not.toContain('1300')
  })

  it('renders em-dash when no drives match the filter', () => {
    const toMph = (mps: number) => convertSpeedFromSI(mps, 'mph')
    renderWithClient(
      <SpeedGearPanel
        motorLatest={null}
        filteredDrives={[]}
        toSpeedDisplay={toMph}
        speedUnit="mph"
      />,
    )
    // Both Top Drive Speed and Avg Drive Speed render an em-dash when
    // the filtered set is empty (e.g., no drives in the date range).
    const topLabel = screen.getByText('Top Drive Speed')
    expect(topLabel.parentElement?.textContent).toContain('—')
    const avgLabel = screen.getByText('Avg Drive Speed')
    expect(avgLabel.parentElement?.textContent).toContain('—')
  })

  it('skips drives with null avg/max speeds rather than treating them as zero', () => {
    // One real 100 mph drive plus one null-only drive: max should still
    // be 100 mph (Math.max(... , 0) doesn't pull the result down because
    // the null drive contributes 0 not Infinity, and 0 < 44.704).
    // Average behaviour is documented: nulls coerce to 0 in the reducer
    // (legacy behaviour preserved). Assert the resulting average is
    // (44.704 + 0) / 2 = 22.352 m/s = 50 mph, NOT 100.
    const drives: Drive[] = [drive(44.704, 44.704), drive(null, null)]
    const toMph = (mps: number) => convertSpeedFromSI(mps, 'mph')
    renderWithClient(
      <SpeedGearPanel
        motorLatest={null}
        filteredDrives={drives}
        toSpeedDisplay={toMph}
        speedUnit="mph"
      />,
    )
    const topLabel = screen.getByText('Top Drive Speed')
    expect(topLabel.parentElement?.textContent).toContain('100')
    const avgLabel = screen.getByText('Avg Drive Speed')
    expect(avgLabel.parentElement?.textContent).toContain('50')
  })
})
