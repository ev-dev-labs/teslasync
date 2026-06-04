// Trip planner LLM agent tests.
//
// `TestTripPlannerAIOffUsesHeuristicPlanner` mounts the
// AITripPlannerLLMAgent component with ai_mode='off' (plus the
// per-feature toggle on, to defeat the obvious "off because
// nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND trip-planner-llm-agent=true,
//      the section IS present + carries the expected test ID.
//      This is the positive control that proves the gate actually
//      works (otherwise the "absent in off mode" assertion is
//      trivially true).
//
// The HTTP POST /api/v1/ai/trips/plan/draft 404-in-off-mode
// invariant is proven by the Go-side
// TestTripPlannerAIOffUsesHeuristicPlanner in
// internal/api/ai_trip_planner_llm_handler_test.go — the network
// layer does not exist in the React unit-test scope. The "uses
// heuristic planner" semantic refers to the parent
// TripPlannerPage which keeps rendering the deterministic plan
// form + manual Plan button + baseline plan envelope regardless
// of this AI section's visibility.
//
// File name MUST stay `TestTripPlannerAIOffUsesHeuristicPlanner.test.tsx`
// because Vitest's positional pattern is matched against the file path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AITripPlannerLLMAgent } from '@/components/ai/AITripPlannerLLMAgent';

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

describe('TestTripPlannerAIOffUsesHeuristicPlanner (trip-planner-llm-agent AI-off contract)', () => {
  it('TestTripPlannerAIOffUsesHeuristicPlanner: renders nothing when ai_mode=off even with the trip-planner-llm-agent toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". The mode='off' check MUST trump the per-feature toggle.
    //
    // The vehicleId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a missing
    // prop) is what hides the section. In production the parent
    // TripPlannerPage always passes the currently selected
    // vehicle's id from useSelectedVehicle.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'trip-planner-llm-agent': true },
      }),
    );

    const { container } = render(<AITripPlannerLLMAgent vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-trip-planner-llm-agent-root'),
    ).not.toBeInTheDocument();
  });

  it('TestTripPlannerAIOffUsesHeuristicPlanner: renders nothing when ai_mode is non-off but the trip-planner-llm-agent toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'trip-planner-llm-agent': false },
      }),
    );

    const { container } = render(<AITripPlannerLLMAgent vehicleId={42} />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-trip-planner-llm-agent-root'),
    ).not.toBeInTheDocument();
  });

  it('TestTripPlannerAIOffUsesHeuristicPlanner: renders the section when ai_mode=cloud AND trip-planner-llm-agent toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'trip-planner-llm-agent': true },
      }),
    );

    render(<AITripPlannerLLMAgent vehicleId={42} />);
    const root = screen.getByTestId('ai-feature-trip-planner-llm-agent-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'trip-planner-llm-agent');
  });
});
