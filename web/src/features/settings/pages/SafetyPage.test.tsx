/**
 * SafetyPage — comprehensive unit contract for `/settings/safety`.
 *
 * SafetyPage has a single default export; this file exercises its full
 * behaviour surface end to end by mounting the page with a mocked
 * `useSettings()` and the real (fallback) i18n `t`:
 *
 *   1. Page chrome + accessibility — page/section headings, KPI + Helix
 *      region labels, and the listing containers.
 *   2. Safety-posture KPI band — the four deterministically-derived metrics
 *      (active safeguards count, quiet-hours window, translated alert cadence,
 *      Fleet-API kill-switch), including every branch and the blank-string
 *      edge cases that must never surface an empty value.
 *   3. Deterministic listing — all seven `SafetySettingCard` tiles, each
 *      value + status-colour, and the per-row docs deep-link a11y contract.
 *   4. Helix narrator gating — absent when AI is off / toggle off, present in
 *      the cloud + toggle-on positive control (ADR-015 §I5/§I7).
 *   5. Narrator interaction — clicking "Ask Helix" streams exactly one POST to
 *      the registered safety-explain route and renders the first delta.
 *
 * The blank-string cases (`quiet_hours_start=''`, `alert_digest_mode=''`)
 * pin the `coalesceBlank` hardening in the source: an unset backend column can
 * return '' rather than null, and `??` alone would render an empty chip/KPI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  within,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react'

import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}))

import { useSettings } from '@/hooks/useSettings'
import { usePageTitle } from '@/hooks/usePageTitle'
import SafetyPage from './SafetyPage'
import { BADGE_VARIANTS } from '@/components/ui';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>
const mockUsePageTitle = usePageTitle as unknown as ReturnType<typeof vi.fn>

// The source renders two Unicode dashes verbatim (verified against
// SafetyPage.tsx): an em dash (U+2014) marks a missing value, an en dash
// (U+2013) joins the quiet-window start/end. Reference them by code point so
// the assertions stay unambiguous regardless of editor glyph rendering.
const EM_DASH = '\u2014'
const EN_DASH = '\u2013'

// Complete AppSettings with realistic non-AI defaults. The safety-relevant
// fields are a deliberate mixture of on/off + start/end so the listing has
// visible, distinguishable content; per-test overrides flip individual fields.
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
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'hourly',
  critical_flash_enabled: true,
  tab_badge_enabled: true,
}

function mountWith(overrides: Partial<AppSettings> = {}) {
  mockUseSettings.mockReturnValue({ settings: { ...baseSettings, ...overrides } })
  return render(<SafetyPage />)
}

function kpiRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Safety posture' })
}

function valueBadge(titleKey: string): HTMLElement {
  return screen.getByTestId(`safety-settings-value-${titleKey}`)
}

// makeReadableStream + sseFrame mirror the useAiStream test helpers so the
// stream parser receives byte-for-byte equivalent SSE input.
function makeReadableStream(chunks: ReadonlyArray<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]))
        i++
      } else {
        controller.close()
      }
    },
  })
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

beforeEach(() => {
  mockUseSettings.mockReset()
  mockUsePageTitle.mockReset()
})

describe('SafetyPage — page chrome & accessibility', () => {
  it('sets the page title and renders the page + listing section headings', () => {
    mountWith()

    expect(mockUsePageTitle).toHaveBeenCalledWith('Safety settings')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Safety settings' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'Your safety-related settings',
      }),
    ).toBeInTheDocument()
  })

  it('labels the KPI and Helix landmark regions and mounts the listing containers', () => {
    mountWith()

    expect(
      screen.getByRole('region', { name: 'Safety posture' }),
    ).toBeInTheDocument()
    // The Helix section wrapper is always present; only its inner AI card is
    // conditionally rendered by the withAiFeature gate.
    expect(
      screen.getByRole('region', { name: 'Helix assistant' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('safety-settings-listing')).toBeInTheDocument()
    expect(screen.getByTestId('safety-settings-rows')).toBeInTheDocument()
  })
})

describe('SafetyPage — safety-posture KPI band', () => {
  it('counts all three safeguards as active when quiet hours, critical flash, and tab badge are on', () => {
    mountWith({
      quiet_hours_enabled: true,
      critical_flash_enabled: true,
      tab_badge_enabled: true,
    })

    const kpi = kpiRegion()
    expect(within(kpi).getByText('Active safeguards')).toBeInTheDocument()
    expect(within(kpi).getByText('3 / 3')).toBeInTheDocument()
  })

  it('counts a partial safeguard set (only quiet hours on)', () => {
    mountWith({
      quiet_hours_enabled: true,
      critical_flash_enabled: false,
      tab_badge_enabled: false,
    })

    expect(within(kpiRegion()).getByText('1 / 3')).toBeInTheDocument()
  })

  it('counts zero safeguards when all three are off', () => {
    mountWith({
      quiet_hours_enabled: false,
      critical_flash_enabled: false,
      tab_badge_enabled: false,
    })

    expect(within(kpiRegion()).getByText('0 / 3')).toBeInTheDocument()
  })

  it('renders the quiet-hours window as start–end when enabled', () => {
    mountWith({
      quiet_hours_enabled: true,
      quiet_hours_start: '23:30',
      quiet_hours_end: '06:15',
    })

    expect(
      within(kpiRegion()).getByText(`23:30${EN_DASH}06:15`),
    ).toBeInTheDocument()
  })

  it('renders the quiet window as "Off" when quiet hours are disabled', () => {
    mountWith({ quiet_hours_enabled: false })

    const kpi = kpiRegion()
    expect(within(kpi).getByText('Quiet window')).toBeInTheDocument()
    expect(within(kpi).getByText('Off')).toBeInTheDocument()
  })

  it('coerces a blank quiet-hours window to dashes rather than an empty value', () => {
    // Bug guard: an unset HH:MM column can come back as '' / whitespace, which
    // `??` would pass straight through as a blank KPI value.
    mountWith({
      quiet_hours_enabled: true,
      quiet_hours_start: '',
      quiet_hours_end: '   ',
    })

    expect(
      within(kpiRegion()).getByText(`${EM_DASH}${EN_DASH}${EM_DASH}`),
    ).toBeInTheDocument()
  })

  it('translates the alert-cadence label for a known digest mode', () => {
    mountWith({ alert_digest_mode: 'daily' })

    const kpi = kpiRegion()
    expect(within(kpi).getByText('Alert cadence')).toBeInTheDocument()
    // The KPI shows the translated label ("Daily"); the listing row below
    // shows the raw canonical enum ("daily").
    expect(within(kpi).getByText('Daily')).toBeInTheDocument()
  })

  it('falls back to the Instant cadence label when the digest mode is blank', () => {
    // Bug guard: '' digest would otherwise leave the cadence KPI empty.
    mountWith({ alert_digest_mode: '' })

    expect(within(kpiRegion()).getByText('Instant')).toBeInTheDocument()
  })

  it('shows an unknown digest value verbatim instead of crashing or blanking', () => {
    mountWith({ alert_digest_mode: 'weekly' })

    expect(within(kpiRegion()).getByText('weekly')).toBeInTheDocument()
  })

  it('reflects the Fleet API kill-switch when suspended', () => {
    mountWith({ api_suspended: true })

    const kpi = kpiRegion()
    expect(within(kpi).getByText('Fleet API')).toBeInTheDocument()
    expect(within(kpi).getByText('Suspended')).toBeInTheDocument()
    expect(within(kpi).queryByText('Active')).not.toBeInTheDocument()
  })

  it('reflects the Fleet API kill-switch when active', () => {
    mountWith({ api_suspended: false })

    const kpi = kpiRegion()
    expect(within(kpi).getByText('Active')).toBeInTheDocument()
    expect(within(kpi).queryByText('Suspended')).not.toBeInTheDocument()
  })
})

describe('SafetyPage — deterministic safety-settings listing', () => {
  it('renders every safety setting row title exactly once', () => {
    mountWith()

    for (const title of [
      'Quiet hours',
      'Quiet-hours window start',
      'Quiet-hours window end',
      'Alert digest mode',
      'Critical-alert tab flash',
      'Unread tab badge',
      'API kill-switch',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }

    const list = screen.getByTestId('safety-settings-rows')
    expect(within(list).getAllByRole('listitem')).toHaveLength(7)
  })

  it('renders boolean settings as On/Off with success/neutral status colour', () => {
    mountWith({
      quiet_hours_enabled: true,
      critical_flash_enabled: false,
      tab_badge_enabled: true,
    })

    expect(
      valueBadge('safetySettings.rows.quietHoursEnabled.title'),
    ).toHaveTextContent('On')
    expect(
      valueBadge('safetySettings.rows.criticalFlashEnabled.title'),
    ).toHaveTextContent('Off')
    expect(
      valueBadge('safetySettings.rows.tabBadgeEnabled.title'),
    ).toHaveTextContent('On')

    // Colour is a secondary status signal: ON => success, OFF => neutral.
    expect(
      valueBadge('safetySettings.rows.quietHoursEnabled.title').className,
    ).toContain('bg-green-100')
    expect(
      valueBadge('safetySettings.rows.criticalFlashEnabled.title').className,
    ).toContain(BADGE_VARIANTS.neutral)
  })

  it('renders quiet-hours times, dashing out a blank value', () => {
    mountWith({ quiet_hours_start: '01:23', quiet_hours_end: '' })

    expect(
      valueBadge('safetySettings.rows.quietHoursStart.title'),
    ).toHaveTextContent('01:23')
    // Bug guard: '' must not surface as an empty badge.
    expect(
      valueBadge('safetySettings.rows.quietHoursEnd.title'),
    ).toHaveTextContent(EM_DASH)
  })

  it('renders the raw digest enum in the listing', () => {
    mountWith({ alert_digest_mode: 'daily' })

    expect(
      valueBadge('safetySettings.rows.alertDigestMode.title'),
    ).toHaveTextContent('daily')
  })

  it('defaults a blank digest enum to instant in the listing', () => {
    mountWith({ alert_digest_mode: '' })

    expect(
      valueBadge('safetySettings.rows.alertDigestMode.title'),
    ).toHaveTextContent('instant')
  })

  it('maps the API kill-switch to Suspended with a warning colour when suspended', () => {
    mountWith({ api_suspended: true })

    const badge = valueBadge('safetySettings.rows.apiSuspended.title')
    expect(badge).toHaveTextContent('Suspended')
    expect(badge.className).toContain('bg-yellow-100')
  })

  it('maps the API kill-switch to Active with a success colour when not suspended', () => {
    mountWith({ api_suspended: false })

    const badge = valueBadge('safetySettings.rows.apiSuspended.title')
    expect(badge).toHaveTextContent('Active')
    expect(badge.className).toContain('bg-green-100')
  })

  it('gives every row a safe docs deep-link with a descriptive accessible name', () => {
    mountWith()

    const list = screen.getByTestId('safety-settings-rows')
    const links = within(list).getAllByRole('link')
    expect(links).toHaveLength(7)

    for (const link of links) {
      expect(link).toHaveAttribute('href')
      expect(link).toHaveAttribute('rel', 'noreferrer')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('aria-label')).toMatch(/^Open documentation for /)
    }

    // Spot-check one canonical docs anchor against SAFETY_ROWS.
    const apiRowLink = within(
      screen.getByTestId('safety-settings-row-safetySettings.rows.apiSuspended.title'),
    ).getByRole('link')
    expect(apiRowLink).toHaveAttribute('href', '/docs/operations/api-suspended.md')
  })
})

describe('SafetyPage — Helix narrator gating (AI-off contract)', () => {
  it('hides the AI narrator when ai_mode is off even if the feature toggle is on', () => {
    mountWith({
      ai_mode: 'off',
      ai_features: { 'safety-setting-explainer': true },
    })

    expect(
      screen.queryByTestId('ai-feature-safety-setting-explainer-root'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Explain my settings/i }),
    ).not.toBeInTheDocument()
    // The deterministic listing is always available as the static fallback.
    expect(screen.getByText('Quiet hours')).toBeInTheDocument()
  })

  it('hides the AI narrator when the per-feature toggle is off in cloud mode', () => {
    mountWith({
      ai_mode: 'cloud',
      ai_features: { 'safety-setting-explainer': false },
    })

    expect(
      screen.queryByTestId('ai-feature-safety-setting-explainer-root'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('API kill-switch')).toBeInTheDocument()
  })

  it('mounts the AI narrator when cloud mode and the toggle are both on (positive control)', () => {
    mountWith({
      ai_mode: 'cloud',
      ai_features: { 'safety-setting-explainer': true },
    })

    const root = screen.getByTestId('ai-feature-safety-setting-explainer-root')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-ai-feature', 'safety-setting-explainer')
    expect(
      screen.getByRole('button', { name: /Explain my settings/i }),
    ).toBeInTheDocument()
    // Baseline listing still renders alongside the narrator (ADR-015 §I3).
    expect(screen.getByText('API kill-switch')).toBeInTheDocument()
  })
})

describe('SafetyPage — Helix narrator interaction', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('streams exactly one POST to the safety-explain route when Ask Helix is clicked', async () => {
    mountWith({
      ai_mode: 'cloud',
      ai_features: { 'safety-setting-explainer': true },
    })

    const calls: Array<{ url: string; init?: RequestInit }> = []
    const sseBody =
      sseFrame('delta', {
        text: 'Quiet hours are on from 22:00 to 07:00; digest is hourly.',
      }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 42, out: 12 } })
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init })
        return new Response(makeReadableStream([sseBody]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      },
    ) as unknown as typeof globalThis.fetch

    const button = screen.getByRole('button', { name: /Explain my settings/i })
    expect(button).not.toBeDisabled()

    await act(async () => {
      fireEvent.click(button)
    })

    await waitFor(() => expect(calls).toHaveLength(1))
    // useAiStream prepends `${getApiBase()}/api/v1`; getApiBase() is '' under
    // test so the final route is /api/v1/ai/settings/safety/explain.
    expect(calls[0].url).toBe('/api/v1/ai/settings/safety/explain')
    expect(calls[0].init?.method).toBe('POST')

    // The first streamed delta lands inside the gated wrapper.
    await waitFor(() =>
      expect(
        screen.getByTestId('ai-feature-safety-setting-explainer-root'),
      ).toHaveTextContent(
        'Quiet hours are on from 22:00 to 07:00; digest is hourly.',
      ),
    )
  })
})
