/**
 * DevToolsOverview contract tests.
 *
 * DevToolsOverview is the always-visible KPI cockpit band on the Developer
 * Tools page. It mixes two *live* fleet-health KPIs (telemetry errors, vehicle
 * count) with three *static* catalog KPIs derived from local constants. These
 * tests exercise every facet of that contract:
 *
 *   1. Structure   — the band is a single labelled landmark and renders all
 *                    five KPI cards, each with its English label.
 *   2. Static KPIs — endpoint / signal / reference counts are derived from the
 *                    shared constants (never hardcoded magic numbers) and stay
 *                    truthful regardless of live-source state.
 *   3. Live KPIs   — truthful counts render when both sources have resolved.
 *   4. Loading     — both live KPIs degrade to the "—" placeholder while the
 *                    static catalog KPIs keep rendering their real counts.
 *   5. Error       — both live KPIs show "—" and NEVER a fabricated `0` that
 *                    would read as a healthy fleet ("don't lie on error").
 *   6. Icon tone   — the Telemetry Errors icon is red when errors exist, green
 *                    when there are none, and a neutral tone while the count is
 *                    unknown (regression guard: an unknown value must not be
 *                    health-coded green/red behind the "—" placeholder).
 *   7. Null safety — undefined live counts coerce to `0` rather than crashing
 *                    or rendering `NaN`.
 *   8. a11y        — icon glyphs are aria-hidden and the band exposes an
 *                    accessible name for assistive tech.
 *
 * The component only reaches for `react-i18next` and the presentational
 * `MetricCard`; there is no network, react-query, or router dependency, so the
 * band renders bare. `react-i18next` is mocked (the same seam the sibling
 * admin component tests use) so `t(key, fallback)` returns the English default
 * and label assertions stay deterministic.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { DevToolsOverview } from './DevToolsOverview'
import { TESLA_ENDPOINTS, TELEMETRY_FIELDS, REFERENCE_LINKS } from './constants'

// Expected static catalog sizes — computed the same way the component does so
// the assertions can never drift from the reference tables the tabs render.
const EXPECTED_SIGNAL_COUNT = TELEMETRY_FIELDS.reduce(
  (sum, category) => sum + category.fields.length,
  0,
)

/** Return the MetricCard root element that owns the given label text. */
function getCard(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  const card = labelNode.closest('[data-role="metric-card"]')
  if (!card) throw new Error(`no MetricCard found for label "${label}"`)
  return card as HTMLElement
}

describe('DevToolsOverview', () => {
  it('renders all five KPI cards inside a single labelled landmark', () => {
    render(<DevToolsOverview errorVinCount={2} vehicleCount={5} />)

    const band = screen.getByRole('region', {
      name: 'Developer tools overview',
    })
    expect(band).toBeInTheDocument()

    for (const label of [
      'Telemetry Errors',
      'Vehicles',
      'Fleet API Endpoints',
      'Telemetry Signals',
      'Reference Docs',
    ]) {
      expect(within(band).getByText(label)).toBeInTheDocument()
    }
  })

  it('derives the static catalog counts from the shared constants', () => {
    render(<DevToolsOverview errorVinCount={2} vehicleCount={5} />)

    expect(
      within(getCard('Fleet API Endpoints')).getByText(
        String(TESLA_ENDPOINTS.length),
      ),
    ).toBeInTheDocument()
    expect(
      within(getCard('Telemetry Signals')).getByText(
        String(EXPECTED_SIGNAL_COUNT),
      ),
    ).toBeInTheDocument()
    expect(
      within(getCard('Reference Docs')).getByText(
        String(REFERENCE_LINKS.length),
      ),
    ).toBeInTheDocument()

    // Sanity-guard the derived total is a real, non-trivial catalog size so a
    // future accidental `[]` in constants can't silently pass this suite.
    expect(EXPECTED_SIGNAL_COUNT).toBeGreaterThan(50)
  })

  it('renders truthful live counts once both sources have resolved', () => {
    render(<DevToolsOverview errorVinCount={7} vehicleCount={12} />)

    expect(within(getCard('Telemetry Errors')).getByText('7')).toBeInTheDocument()
    expect(within(getCard('Vehicles')).getByText('12')).toBeInTheDocument()
    // No placeholder anywhere when the live data is present.
    expect(screen.queryAllByText('—')).toHaveLength(0)
  })

  it('shows the "—" placeholder for both live KPIs while loading', () => {
    render(<DevToolsOverview errorVinCount={7} vehicleCount={12} loading />)

    // Exactly the two live KPIs are unknown — the static catalogs are not.
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(within(getCard('Telemetry Errors')).getByText('—')).toBeInTheDocument()
    expect(within(getCard('Vehicles')).getByText('—')).toBeInTheDocument()
    // The concrete live counts must not leak through the placeholder.
    expect(within(getCard('Telemetry Errors')).queryByText('7')).toBeNull()

    // Static catalog KPIs stay truthful even while live sources load.
    expect(
      within(getCard('Fleet API Endpoints')).getByText(
        String(TESLA_ENDPOINTS.length),
      ),
    ).toBeInTheDocument()
  })

  it('degrades live KPIs to "—" on error without fabricating a healthy 0', () => {
    render(<DevToolsOverview errorVinCount={0} vehicleCount={0} errored />)

    expect(screen.getAllByText('—')).toHaveLength(2)
    // Regression guard: a failed load must never render a `0` that reads as a
    // healthy, empty fleet. None of the static catalogs are 0 either.
    expect(screen.queryByText('0')).toBeNull()
  })

  it('tones the Telemetry Errors icon red when there are errors', () => {
    render(<DevToolsOverview errorVinCount={3} vehicleCount={9} />)

    const card = getCard('Telemetry Errors')
    const icon = card.querySelector('[data-role="metric-icon"]')
    expect(icon).toHaveAttribute('data-color', 'red')
  })

  it('tones the Telemetry Errors icon green when there are zero errors', () => {
    render(<DevToolsOverview errorVinCount={0} vehicleCount={9} />)

    const card = getCard('Telemetry Errors')
    const icon = card.querySelector('[data-role="metric-icon"]')
    expect(icon).toHaveAttribute('data-color', 'green')
  })

  it('uses a neutral icon tone while the error count is unknown', () => {
    // loading → the count is unknown, so the icon must not imply a healthy
    // (green) or alarmed (red) fleet behind the "—" placeholder.
    render(<DevToolsOverview errorVinCount={4} vehicleCount={9} loading />)

    const card = getCard('Telemetry Errors')
    const icon = card.querySelector('[data-role="metric-icon"]')
    expect(icon).toHaveAttribute('data-color', 'cyan')
  })

  it('coerces undefined live counts to 0 instead of rendering NaN', () => {
    // A misbehaving parent could pass a non-number; the `?? 0` guard keeps the
    // band from rendering `NaN`/`undefined`.
    render(
      <DevToolsOverview
        errorVinCount={undefined as unknown as number}
        vehicleCount={undefined as unknown as number}
      />,
    )

    expect(within(getCard('Telemetry Errors')).getByText('0')).toBeInTheDocument()
    expect(within(getCard('Vehicles')).getByText('0')).toBeInTheDocument()
    expect(screen.queryByText('NaN')).toBeNull()
  })

  it('hides decorative KPI icons from assistive tech', () => {
    render(<DevToolsOverview errorVinCount={2} vehicleCount={5} />)

    const icon = getCard('Vehicles').querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})
