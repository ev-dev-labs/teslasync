import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { ConflictWarnings } from './ConflictWarnings'
import type { AutomationConflict } from '@/api/types'

// Deterministic i18n: `t(key, fallback)` yields the inline English default so
// assertions never depend on the loaded locale bundle. Mirrors the repo-wide
// convention used by other component tests (see VehicleSettingsTab.test.tsx).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

function makeConflict(overrides: Partial<AutomationConflict> = {}): AutomationConflict {
  return {
    automation_id: 1,
    automation_name: 'Overlap Rule',
    reason: 'shares a trigger window',
    severity: 'warning',
    ...overrides,
  }
}

describe('ConflictWarnings', () => {
  it('renders nothing when the conflicts array is empty', () => {
    const { container } = render(<ConflictWarnings conflicts={[]} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders nothing (and does not throw) when conflicts is undefined', () => {
    // Automation.conflicts is optional upstream; guarding the prop prevents a
    // "Cannot read properties of undefined (reading 'length')" crash.
    const { container } = render(<ConflictWarnings conflicts={undefined} />)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('renders a warning conflict with the warning variant, title and body copy', () => {
    render(
      <ConflictWarnings
        conflicts={[makeConflict({ automation_name: 'Night Charge', reason: 'overlaps a schedule' })]}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('border-neon-amber/25')
    expect(within(alert).getByText('Potential Conflict')).toBeInTheDocument()
    expect(within(alert).getByText('"Night Charge": overlaps a schedule')).toBeInTheDocument()
  })

  it('uses the info variant (not warning) for info-severity conflicts', () => {
    render(
      <ConflictWarnings conflicts={[makeConflict({ severity: 'info', automation_name: 'FYI Rule' })]} />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.className).toContain('border-neon-cyan/25')
    expect(alert.className).not.toContain('border-neon-amber/25')
  })

  it('defaults unexpected severities to the info variant', () => {
    const weird = makeConflict({ severity: 'critical' as unknown as AutomationConflict['severity'] })
    render(<ConflictWarnings conflicts={[weird]} />)
    expect(screen.getByRole('alert').className).toContain('border-neon-cyan/25')
  })

  it('renders one alert per conflict, preserving order and mixed severities', () => {
    render(
      <ConflictWarnings
        conflicts={[
          makeConflict({ automation_id: 1, automation_name: 'A', reason: 'r1', severity: 'warning' }),
          makeConflict({ automation_id: 2, automation_name: 'B', reason: 'r2', severity: 'info' }),
          makeConflict({ automation_id: 3, automation_name: 'C', reason: 'r3', severity: 'warning' }),
        ]}
      />,
    )
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(3)
    expect(within(alerts[0]).getByText('"A": r1')).toBeInTheDocument()
    expect(within(alerts[1]).getByText('"B": r2')).toBeInTheDocument()
    expect(within(alerts[2]).getByText('"C": r3')).toBeInTheDocument()
    expect(alerts[0].className).toContain('border-neon-amber/25')
    expect(alerts[1].className).toContain('border-neon-cyan/25')
  })

  it('marks the leading icon as decorative (aria-hidden) so it is not announced', () => {
    render(<ConflictWarnings conflicts={[makeConflict()]} />)
    const alert = screen.getByRole('alert')
    const icons = alert.querySelectorAll('svg')
    expect(icons).toHaveLength(1)
    expect(icons[0]).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back to placeholders when automation_name or reason are missing', () => {
    const conflicts = [
      makeConflict({ automation_id: 10, automation_name: null as unknown as string, reason: 'unnamed rule' }),
      makeConflict({ automation_id: 11, automation_name: 'No Reason', reason: null as unknown as string }),
    ]
    render(<ConflictWarnings conflicts={conflicts} />)
    const alerts = screen.getAllByRole('alert')
    expect(within(alerts[0]).getByText('"—": unnamed rule')).toBeInTheDocument()
    // An empty reason must not leave a dangling '"No Reason": ' with a trailing colon.
    expect(within(alerts[1]).getByText('"No Reason"')).toBeInTheDocument()
    expect(within(alerts[1]).queryByText('"No Reason": ')).toBeNull()
  })
})
