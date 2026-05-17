// Phase-50 / 0023 — D3 Route-efficiency suggestions.
//
// `TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly` (the Vitest
// sibling to the Go test of the same name) is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AIRouteEfficiencySuggestions component with ai_mode='off'
// (plus the per-feature toggle on, to defeat the obvious "off
// because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND route-efficiency-suggestions=true,
//      the section IS present + carries the expected test ID. This
//      is the positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//
// The HTTP /api/v1/ai/routes/{routeID}/efficiency/suggest
// 404-in-off-mode invariant is proven by the Go-side
// TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly in
// internal/api/ai_route_efficiency_handler_test.go — the network
// layer does not exist in the React unit-test scope. The "shows
// metrics only" semantic refers to the parent RouteEfficiencyPage
// which keeps rendering the deterministic RouteCards + kWh/100mi
// summary stats regardless of this AI section's visibility.
//
// File name MUST stay
// `TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly.test.tsx`
// — the slice prompt's verification command runs
// `vitest --run TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIRouteEfficiencySuggestions } from '@/components/ai/AIRouteEfficiencySuggestions';

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

describe('TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly (route-efficiency-suggestions AI-off contract)', () => {
  it('TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly: renders nothing when ai_mode=off even with the route-efficiency-suggestions toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". The mode='off' check MUST trump the per-feature toggle
    // (ADR-015 §I7).
    //
    // The vehicleId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a missing
    // prop) is what hides the section. In production the parent
    // RouteEfficiencyPage always passes the currently selected
    // vehicle's id from useSelectedVehicle.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'route-efficiency-suggestions': true },
      }),
    );

    const { container } = render(<AIRouteEfficiencySuggestions vehicleId="42" />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-route-efficiency-suggestions-root'),
    ).not.toBeInTheDocument();
  });

  it('TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly: renders nothing when ai_mode is non-off but the route-efficiency-suggestions toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'route-efficiency-suggestions': false },
      }),
    );

    const { container } = render(<AIRouteEfficiencySuggestions vehicleId="42" />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-route-efficiency-suggestions-root'),
    ).not.toBeInTheDocument();
  });

  it('TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly: renders the section when ai_mode=cloud AND route-efficiency-suggestions toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'route-efficiency-suggestions': true },
      }),
    );

    render(<AIRouteEfficiencySuggestions vehicleId="42" />);
    const root = screen.getByTestId('ai-feature-route-efficiency-suggestions-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'route-efficiency-suggestions');
  });
});
