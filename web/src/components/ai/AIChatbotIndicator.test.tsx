// Comprehensive unit tests for AIChatbotIndicator.
//
// The module has a single export — AIChatbotIndicator — which is the
// internal InnerIndicator badge wrapped by the
// withAiFeature('chatbot-llm', …) AI-off gate (ADR-015). The tests
// cover every facet of that one surface:
//
//   • AI-off contract (the negative controls): off mode, a non-off
//     mode with the per-feature toggle off, the toggle missing, and an
//     unresolved settings query all render nothing (fail-closed).
//   • Positive control: BOTH non-off modes (local + cloud) with the
//     toggle on render the badge inside the data-ai-feature marker
//     root — so the negative assertions above aren't trivially true.
//   • Badge anatomy + a11y: the chip is a labelled image
//     (role="img" / aria-label) so screen readers get a stable name,
//     the Helix glyph is decorative (aria-hidden) and therefore not
//     double-announced, the visible "Helix" label matches the
//     accessible name (WCAG 2.5.3 Label-in-Name), and the long-form
//     explanation is carried on the title attribute.
//   • Metadata: the stable displayName the lazy loader / DevTools use.
//
// react-i18next's useTranslation returns the 2nd argument (English
// fallback) when no provider is mounted, so no i18n setup is needed —
// the same convention every sibling AI test in this dir relies on.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { AppSettings } from '@/api/types'

// A file-level mock takes precedence over the global useSettings stub
// in src/test-setup.ts, letting each test drive ai_mode / ai_features.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { AIChatbotIndicator } from './AIChatbotIndicator'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

// A complete AppSettings with realistic non-AI defaults; per-test cases
// override ai_mode + ai_features to exercise the gate.
const baseSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
}

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } }
}

// enabled() is the "feature fully on" state used by the positive tests.
function enabled(mode: 'local' | 'cloud' = 'cloud') {
  return settingsPayload({
    ai_mode: mode,
    ai_features: { 'chatbot-llm': true },
  })
}

// The withAiFeature marker root testid comes from the real AI_FEATURES
// registry entry for chatbot-llm (uiTestIds[0]).
const ROOT_TESTID = 'ai-feature-chatbot-llm-root'

beforeEach(() => {
  mockUseSettings.mockReset()
  mockUseSettings.mockReturnValue(enabled())
})

describe('AIChatbotIndicator — AI-off contract gate', () => {
  it('renders nothing when ai_mode=off even with the chatbot-llm toggle on', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { 'chatbot-llm': true } }),
    )

    const { container } = render(<AIChatbotIndicator />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders nothing when a non-off mode has the chatbot-llm toggle set to false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { 'chatbot-llm': false } }),
    )

    const { container } = render(<AIChatbotIndicator />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing when the chatbot-llm flag is entirely absent from ai_features', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'local', ai_features: {} }),
    )

    const { container } = render(<AIChatbotIndicator />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })

  it('renders nothing (fail-closed) when the settings query has not resolved yet', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })

    const { container } = render(<AIChatbotIndicator />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId(ROOT_TESTID)).not.toBeInTheDocument()
  })
})

describe('AIChatbotIndicator — enabled rendering (positive control)', () => {
  it('renders the badge inside the data-ai-feature marker root when mode=local + toggle on', () => {
    mockUseSettings.mockReturnValue(enabled('local'))

    render(<AIChatbotIndicator />)

    const root = screen.getByTestId(ROOT_TESTID)
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'chatbot-llm')
    expect(root).toHaveTextContent('Helix')
  })

  it('also renders when mode=cloud (both non-off modes pass the gate)', () => {
    mockUseSettings.mockReturnValue(enabled('cloud'))

    render(<AIChatbotIndicator />)

    expect(screen.getByTestId(ROOT_TESTID)).toHaveTextContent('Helix')
    expect(screen.getByRole('img', { name: 'Helix' })).toBeInTheDocument()
  })
})

describe('AIChatbotIndicator — badge anatomy + accessibility', () => {
  beforeEach(() => {
    mockUseSettings.mockReturnValue(enabled('cloud'))
  })

  it('exposes the chip as a labelled image so screen readers announce a stable name', () => {
    render(<AIChatbotIndicator />)

    const badge = screen.getByRole('img', { name: 'Helix' })
    expect(badge).toBeInTheDocument()
    // The accessible name (aria-label) equals the visible label —
    // WCAG 2.5.3 Label-in-Name.
    expect(badge).toHaveTextContent('Helix')
  })

  it('marks the Helix glyph decorative so it is not announced twice', () => {
    render(<AIChatbotIndicator />)

    const badge = screen.getByRole('img', { name: 'Helix' })
    const glyph = badge.querySelector('svg')
    expect(glyph).not.toBeNull()
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
  })

  it('carries the long-form explanation on the title attribute for a hover tooltip', () => {
    render(<AIChatbotIndicator />)

    const badge = screen.getByRole('img', { name: 'Helix' })
    const title = badge.getAttribute('title') ?? ''
    expect(title).toContain('AI assistant')
    expect(title).toContain('redacted fleet context')
  })
})

describe('AIChatbotIndicator — metadata', () => {
  it('exposes a stable displayName for React DevTools and the lazy loader', () => {
    expect(AIChatbotIndicator.displayName).toBe('AIChatbotIndicator')
  })
})
