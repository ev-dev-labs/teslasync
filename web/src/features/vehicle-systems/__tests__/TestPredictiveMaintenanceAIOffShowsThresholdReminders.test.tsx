// Predictive maintenance AI gate coverage.
//
// `TestPredictiveMaintenanceAIOffShowsThresholdReminders` is the
// React-side AI-off contract proof. It
// mounts the AIPredictiveMaintenance component with ai_mode='off'
// (plus the per-feature toggle on, to defeat the obvious "off
// because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND predictive-maintenance toggle=true,
//      the section IS present + carries the expected test ID.
//      This is the positive control that proves the gate actually
//      works (otherwise the "absent in off mode" assertion is
//      trivially true).
//   4. The mode='cloud' path with toggle=false also hides the
//      section — per-feature opt-in (ADR-015 §I7).
//
// The deterministic MaintenancePage baseline (threshold reminders,
// status badges, summary metric cards, upcoming items list) is NOT
// replaced or hidden by this slice. Because the full MaintenancePage
// transitively owns several hooks (useSelectedVehicle, useQuery
// against /api/v1/maintenance + /api/v1/service-records,
// useFormatting), the baseline-coexistence half of the proof is
// covered by the Go-side
// TestPredictiveMaintenanceAIOffShowsThresholdReminders in
// internal/api/ai_predictive_maintenance_handler_test.go, which
// proves the baseline `GET /api/v1/maintenance` snapshot route
// remains reachable when ai_mode='off' AND the AI route
// `POST /api/v1/ai/maintenance/predict` returns 404 — together
// those two halves satisfy ADR-015 §I3 + §I5 + §I6.
//
// The HTTP POST /api/v1/ai/maintenance/predict 404-in-off-mode
// invariant is proven by the Go-side
// TestPredictiveMaintenanceAIOffShowsThresholdReminders in
// internal/api/ai_predictive_maintenance_handler_test.go — the
// network layer does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestPredictiveMaintenanceAIOffShowsThresholdReminders.test.tsx`
// because external verification runs
// `vitest --run TestPredictiveMaintenanceAIOffShowsThresholdReminders`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIPredictiveMaintenance } from '@/components/ai/AIPredictiveMaintenance';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TestPredictiveMaintenanceAIOffShowsThresholdReminders (predictive-maintenance AI-off contract)', () => {
  it('TestPredictiveMaintenanceAIOffShowsThresholdReminders: AIPredictiveMaintenance renders nothing when ai_mode=off even with the predictive-maintenance toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    //
    // The vehicleId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a
    // missing prop) is what hides the section.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'predictive-maintenance': true },
      }),
    );

    const { container } = render(<AIPredictiveMaintenance vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-predictive-maintenance-root'),
    ).not.toBeInTheDocument();
    // Defence-in-depth: the visible AI verb MUST be absent from
    // the DOM in off mode. Use an unanchored regex per the HX
    // addendum — the accessible name reads "Ask Helix · <verb>"
    // when the card paints (positive control below).
    expect(
      screen.queryByRole('button', { name: /Predict maintenance/i }),
    ).not.toBeInTheDocument();
  });

  it('TestPredictiveMaintenanceAIOffShowsThresholdReminders: AIPredictiveMaintenance renders nothing when ai_mode is non-off but the predictive-maintenance toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'predictive-maintenance': false },
      }),
    );

    const { container } = render(<AIPredictiveMaintenance vehicleId={42} />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-predictive-maintenance-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Predict maintenance/i }),
    ).not.toBeInTheDocument();
  });

  it('TestPredictiveMaintenanceAIOffShowsThresholdReminders: AIPredictiveMaintenance renders the section when ai_mode=cloud AND predictive-maintenance toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'predictive-maintenance': true },
      }),
    );

    render(<AIPredictiveMaintenance vehicleId={42} />);
    const root = screen.getByTestId('ai-feature-predictive-maintenance-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'predictive-maintenance');
    // Visible button uses the per-feature verb ("Predict
    // maintenance") inside the accessible name (which reads
    // "Ask Helix · Predict maintenance" once the HX card paints).
    // The regex MUST be unanchored per the HX addendum.
    expect(
      screen.getByRole('button', { name: /Predict maintenance/i }),
    ).toBeInTheDocument();
  });
});
