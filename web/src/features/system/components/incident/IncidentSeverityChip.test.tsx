/**
 * IncidentSeverityChip unit tests.
 *
 * Co-located with the component. Covers the single export
 * `IncidentSeverityChip` across every branch:
 *   1. Each canonical severity (minor / major / critical) renders its
 *      localized label, its tinted tone (bg + border + toned text), and its
 *      severity-specific decorative icon.
 *   2. Labels resolve through the i18n key with an English fallback.
 *   3. A caller-supplied className is merged without dropping base utilities.
 *   4. An unexpected (non-union) severity falls back to the minor tone while
 *      surfacing the raw value verbatim — and does NOT hit i18n.
 *   5. A missing severity never renders an empty chip (shows an em-dash).
 *   6. The icon is decorative (aria-hidden) and the label is the accessible text.
 *
 * react-i18next is mocked so `t(key, fallback)` deterministically returns the
 * fallback and can be asserted against. lucide-react's three severity icons are
 * stubbed with test-ids so each branch's icon can be verified precisely.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { SVGProps } from 'react'

const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tSpy,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<typeof import('lucide-react')>('lucide-react')
  const makeIcon = (testid: string) =>
    function StubIcon(props: SVGProps<SVGSVGElement>) {
      return <svg {...props} data-testid={testid} />
    }
  return {
    ...actual,
    AlertCircle: makeIcon('icon-alert-circle'),
    AlertTriangle: makeIcon('icon-alert-triangle'),
    AlertOctagon: makeIcon('icon-alert-octagon'),
  }
})

import { IncidentSeverityChip } from './IncidentSeverityChip'
import { type IncidentSeverity } from '@/api/hooks/useIncidents'

const CASES = [
  {
    severity: 'minor',
    label: 'Minor',
    key: 'incidentTimeline.severity.minor',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-300',
    icon: 'icon-alert-circle',
  },
  {
    severity: 'major',
    label: 'Major',
    key: 'incidentTimeline.severity.major',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    text: 'text-orange-300',
    icon: 'icon-alert-triangle',
  },
  {
    severity: 'critical',
    label: 'Critical',
    key: 'incidentTimeline.severity.critical',
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    text: 'text-rose-300',
    icon: 'icon-alert-octagon',
  },
] as const

describe('IncidentSeverityChip', () => {
  beforeEach(() => {
    tSpy.mockClear()
  })

  it.each(CASES)(
    'renders the $severity pill with its localized label, tone, and decorative icon',
    ({ severity, label, bg, border, text, icon }) => {
      render(<IncidentSeverityChip severity={severity} />)

      const chip = screen.getByText(label)
      expect(chip.tagName).toBe('SPAN')
      expect(chip.className).toContain(bg)
      expect(chip.className).toContain(border)
      expect(chip.className).toContain(text)

      const svg = screen.getByTestId(icon)
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    },
  )

  it('resolves the label through the i18n key with an English fallback', () => {
    render(<IncidentSeverityChip severity="critical" />)

    expect(tSpy).toHaveBeenCalledWith('incidentTimeline.severity.critical', 'Critical')
    expect(screen.getByText('Critical')).toBeInTheDocument()
  })

  it('merges a caller className while keeping the base pill utilities', () => {
    render(<IncidentSeverityChip severity="minor" className="mt-4 shrink-0" />)

    const chip = screen.getByText('Minor')
    expect(chip).toHaveClass('mt-4')
    expect(chip).toHaveClass('shrink-0')
    expect(chip.className).toContain('rounded-full')
    expect(chip.className).toContain('uppercase')
  })

  it('falls back to the minor tone but surfaces the raw value for an unknown severity', () => {
    render(<IncidentSeverityChip severity={'catastrophic' as IncidentSeverity} />)

    const chip = screen.getByText('catastrophic')
    expect(chip.className).toContain('bg-amber-500/10')
    expect(screen.getByTestId('icon-alert-circle')).toBeInTheDocument()
    // Unknown values bypass localisation — the raw string is shown as-is.
    expect(tSpy).not.toHaveBeenCalled()
  })

  it('never renders an empty chip when the severity is missing', () => {
    render(<IncidentSeverityChip severity={undefined as unknown as IncidentSeverity} />)

    const chip = screen.getByText('—')
    expect(chip).toBeInTheDocument()
    expect(chip.className).toContain('bg-amber-500/10')
    expect(screen.getByTestId('icon-alert-circle')).toBeInTheDocument()
  })

  it('marks the icon decorative and exposes the label as the accessible text', () => {
    const { container } = render(<IncidentSeverityChip severity="major" />)

    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Major')).toHaveTextContent('Major')
  })
})
