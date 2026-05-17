// Phase-50 / 0031 — T1 Preheat and precool recommender.
//
// `TestPreheatPrecoolAIOffManualClimateWorks` (the Vitest sibling
// to the Go test of the same name) is the slice's load-bearing
// AI-OFF contract proof on the React side. It mounts the
// AIPreheatPrecoolRecommender component with ai_mode='off' (plus
// the per-feature toggle on, to defeat the obvious "off because
// nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND preheat-precool-recommender=true,
//      the section IS present + carries the expected test ID.
//      This is the positive control that proves the gate actually
//      works (otherwise the "absent in off mode" assertion is
//      trivially true).
//
// The HTTP POST /api/v1/ai/climate/schedule/draft 404-in-off-mode
// invariant is proven by the Go-side TestPreheatPrecoolAIOff*
// suite in internal/api/ai_climate_schedule_handler_test.go — the
// network layer does not exist in the React unit-test scope. The
// "manual climate works" semantic refers to the parent
// ClimateControlPage which keeps rendering the deterministic HVAC
// banner, status cards, climate efficiency panel, climate history
// table, seat-heater controls, and the manual departure-time
// heuristic regardless of this AI section's visibility.
//
// File name MUST stay
// `TestPreheatPrecoolAIOffManualClimateWorks.test.tsx` — the
// slice prompt's verification command runs
// `vitest --run TestPreheatPrecoolAIOffManualClimateWorks`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIPreheatPrecoolRecommender } from '@/components/ai/AIPreheatPrecoolRecommender';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test cases override `ai_mode` + `ai_features` to
// exercise the off-mode (negative) and on-mode (positive control)
// paths.
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
};

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } };
}

beforeEach(() => {
  mockUseSettings.mockReset();
});

describe('TestPreheatPrecoolAIOffManualClimateWorks (preheat-precool-recommender AI-off contract)', () => {
  it('TestPreheatPrecoolAIOffManualClimateWorks: renders nothing when ai_mode=off even with the preheat-precool-recommender toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    //
    // The vehicleId / temperatures / departBy props are also
    // intentionally set so the absent-in-DOM assertion proves
    // that the gate (not a missing prop) is what hides the
    // section. In production the parent ClimateControlPage
    // always passes the currently selected vehicle's id and the
    // latest cabin/outside temperatures from the active-vehicle
    // context.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'preheat-precool-recommender': true },
      }),
    );

    const { container } = render(
      <AIPreheatPrecoolRecommender
        vehicleId={42}
        currentCabinTempC={4}
        outsideTempC={-2}
        targetCabinTempC={21}
        departBy="2099-01-02T07:30:00Z"
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-preheat-precool-recommender-root'),
    ).not.toBeInTheDocument();
  });

  it('TestPreheatPrecoolAIOffManualClimateWorks: renders nothing when ai_mode is non-off but the preheat-precool-recommender toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'preheat-precool-recommender': false },
      }),
    );

    const { container } = render(
      <AIPreheatPrecoolRecommender
        vehicleId={42}
        currentCabinTempC={4}
        outsideTempC={-2}
        targetCabinTempC={21}
        departBy="2099-01-02T07:30:00Z"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-preheat-precool-recommender-root'),
    ).not.toBeInTheDocument();
  });

  it('TestPreheatPrecoolAIOffManualClimateWorks: renders the section when ai_mode=cloud AND preheat-precool-recommender toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'preheat-precool-recommender': true },
      }),
    );

    render(
      <AIPreheatPrecoolRecommender
        vehicleId={42}
        currentCabinTempC={4}
        outsideTempC={-2}
        targetCabinTempC={21}
        departBy="2099-01-02T07:30:00Z"
      />,
    );
    const root = screen.getByTestId(
      'ai-feature-preheat-precool-recommender-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'preheat-precool-recommender',
    );
  });
});
