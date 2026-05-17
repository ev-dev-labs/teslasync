// Phase-50 / 0026 — C1 Smart-charge schedule suggestion.
//
// `TestSmartChargeScheduleAIOffManualScheduleWorks` (the Vitest
// sibling to the Go test of the same name) is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AISmartChargeScheduleSuggestion component with ai_mode='off'
// (plus the per-feature toggle on, to defeat the obvious "off
// because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND
//      smart-charge-schedule-suggestion=true, the section IS
//      present + carries the expected test ID. This is the
//      positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//
// The HTTP POST /api/v1/ai/charging/schedule/draft 404-in-off-mode
// invariant is proven by the Go-side
// TestSmartChargeScheduleAIOffManualScheduleWorks in
// internal/api/ai_smart_charge_schedule_handler_test.go — the
// network layer does not exist in the React unit-test scope. The
// "manual schedule works" semantic refers to the parent
// SmartChargePage which keeps rendering the deterministic manual
// schedule form + canonical Schedule button + baseline schedule
// envelope regardless of this AI section's visibility.
//
// File name MUST stay
// `TestSmartChargeScheduleAIOffManualScheduleWorks.test.tsx` —
// the slice prompt's verification command runs
// `vitest --run TestSmartChargeScheduleAIOffManualScheduleWorks`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AISmartChargeScheduleSuggestion } from '@/components/ai/AISmartChargeScheduleSuggestion';

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

describe('TestSmartChargeScheduleAIOffManualScheduleWorks (smart-charge-schedule-suggestion AI-off contract)', () => {
  it('TestSmartChargeScheduleAIOffManualScheduleWorks: renders nothing when ai_mode=off even with the smart-charge-schedule-suggestion toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". The mode='off' check MUST trump the per-feature toggle
    // (ADR-015 §I7).
    //
    // The vehicleId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a missing
    // prop) is what hides the section. In production the parent
    // SmartChargePage always passes the currently selected
    // vehicle's id from the smart-charge form state.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'smart-charge-schedule-suggestion': true },
      }),
    );

    const { container } = render(<AISmartChargeScheduleSuggestion vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-smart-charge-schedule-suggestion-root'),
    ).not.toBeInTheDocument();
  });

  it('TestSmartChargeScheduleAIOffManualScheduleWorks: renders nothing when ai_mode is non-off but the smart-charge-schedule-suggestion toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'smart-charge-schedule-suggestion': false },
      }),
    );

    const { container } = render(<AISmartChargeScheduleSuggestion vehicleId={42} />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-smart-charge-schedule-suggestion-root'),
    ).not.toBeInTheDocument();
  });

  it('TestSmartChargeScheduleAIOffManualScheduleWorks: renders the section when ai_mode=cloud AND smart-charge-schedule-suggestion toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'smart-charge-schedule-suggestion': true },
      }),
    );

    render(<AISmartChargeScheduleSuggestion vehicleId={42} />);
    const root = screen.getByTestId('ai-feature-smart-charge-schedule-suggestion-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'smart-charge-schedule-suggestion');
  });
});
