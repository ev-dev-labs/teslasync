// Tire-pressure trend reasoning.
//
// `TestTirePressureReasoningAIOffShowsThresholdsOnly` (the Vitest
// sibling to the Go test of the same name) is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AITirePressureTrendReasoning component with ai_mode='off'
// (plus the per-feature toggle on, to defeat the obvious "off
// because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND
//      tire-pressure-trend-reasoning=true, the section IS
//      present + carries the expected test ID. This is the
//      positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//
// The HTTP POST /api/v1/ai/tire-pressure/trends/explain
// 404-in-off-mode invariant is proven by the Go-side
// TestTirePressureReasoningAIOffShowsThresholdsOnly in
// internal/api/ai_tire_pressure_trend_handler_test.go — the
// network layer does not exist in the React unit-test scope. The
// "shows thresholds only" semantic refers to the parent
// TirePressurePage which keeps rendering the deterministic
// four-corner gauges, soft-low/normal/soft-high threshold
// bands, warning banner, summary metric cards, pressure history
// chart, and history table regardless of this AI section's
// visibility.
//
// File name MUST stay
// `TestTirePressureReasoningAIOffShowsThresholdsOnly.test.tsx` —
// the slice prompt's verification command runs
// `vitest --run TestTirePressureReasoningAIOffShowsThresholdsOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AITirePressureTrendReasoning } from '@/components/ai/AITirePressureTrendReasoning';

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

describe('TestTirePressureReasoningAIOffShowsThresholdsOnly (tire-pressure-trend-reasoning AI-off contract)', () => {
  it('TestTirePressureReasoningAIOffShowsThresholdsOnly: renders nothing when ai_mode=off even with the tire-pressure-trend-reasoning toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    //
    // The vehicleId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a
    // missing prop) is what hides the section. In production
    // the parent TirePressurePage always passes the currently
    // selected vehicle's id from the active-vehicle context.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'tire-pressure-trend-reasoning': true },
      }),
    );

    const { container } = render(<AITirePressureTrendReasoning vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-tire-pressure-trend-reasoning-root'),
    ).not.toBeInTheDocument();
  });

  it('TestTirePressureReasoningAIOffShowsThresholdsOnly: renders nothing when ai_mode is non-off but the tire-pressure-trend-reasoning toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'tire-pressure-trend-reasoning': false },
      }),
    );

    const { container } = render(<AITirePressureTrendReasoning vehicleId={42} />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-tire-pressure-trend-reasoning-root'),
    ).not.toBeInTheDocument();
  });

  it('TestTirePressureReasoningAIOffShowsThresholdsOnly: renders the section when ai_mode=cloud AND tire-pressure-trend-reasoning toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'tire-pressure-trend-reasoning': true },
      }),
    );

    render(<AITirePressureTrendReasoning vehicleId={42} />);
    const root = screen.getByTestId('ai-feature-tire-pressure-trend-reasoning-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'tire-pressure-trend-reasoning');
  });
});
