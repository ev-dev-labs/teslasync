// Phase-50 / 0064 — ML3 Charging-curve fingerprint clustering
// statistical model.
//
// `TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly` (the
// Vitest sibling to the Go test of the same name) is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AIMLChargingCurveClustering component with ai_mode='off'
// (plus the per-feature toggle on, to defeat the obvious "off
// because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND
//      ml-charging-curve-clustering=true, the section IS present +
//      carries the expected test ID. This is the positive control
//      that proves the gate actually works (otherwise the "absent
//      in off mode" assertion is trivially true).
//
// The HTTP POST /api/v1/ai/ml/charging-curves/cluster
// 404-in-off-mode invariant is proven by the Go-side
// TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly in
// internal/api/ai_ml_charging_curve_handler_test.go — the
// network layer does not exist in the React unit-test scope. The
// "uses rule labels only" semantic refers to the parent
// ChargingCurvePage which keeps rendering the deterministic
// charts + rule-based session labels regardless of this AI
// section's visibility.
//
// Sibling distinction: this test is INDEPENDENT of the C3
// `TestChargingCurveClusteringAIOffShowsChartsOnly` test; both
// the C3 narrator (charging-curve-fingerprint-clustering) and
// the ML3 trainer-narrator (ml-charging-curve-clustering)
// coexist on /charging/curves with independent toggles. This
// test ONLY toggles the ML3 feature; the C3 toggle is left
// implicitly off so a regression that conflates the two surfaces
// (e.g. one toggle hiding both, or one toggle accidentally
// enabling both) surfaces here.
//
// File name MUST stay
// `TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly.test.tsx`
// — the slice prompt's verification command runs
// `vitest --run TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIMLChargingCurveClustering } from '@/components/ai/AIMLChargingCurveClustering';

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

describe('TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly (ml-charging-curve-clustering AI-off contract)', () => {
  it('TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly: renders nothing when ai_mode=off even with the ml-charging-curve-clustering toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". The mode='off' check MUST trump the per-feature toggle
    // (ADR-015 §I7).
    //
    // The vehicleId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a missing
    // prop) is what hides the section.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'ml-charging-curve-clustering': true },
      }),
    );

    const { container } = render(
      <AIMLChargingCurveClustering vehicleId={42} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-ml-charging-curve-clustering-root'),
    ).not.toBeInTheDocument();
  });

  it('TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly: renders nothing when ai_mode is non-off but the ml-charging-curve-clustering toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'ml-charging-curve-clustering': false },
      }),
    );

    const { container } = render(
      <AIMLChargingCurveClustering vehicleId={42} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-ml-charging-curve-clustering-root'),
    ).not.toBeInTheDocument();
  });

  it('TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly: renders nothing when ai_mode=off AND ml-charging-curve-clustering=false (defence-in-depth)', () => {
    // Belt-and-braces: both gates closed must still hide the
    // section. A regression that accidentally inverted one
    // condition (e.g. `mode === 'off' || feature === false` with
    // OR instead of AND-of-both-paths) would still pass the
    // single-gate cases above; this one catches it.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'ml-charging-curve-clustering': false },
      }),
    );

    const { container } = render(
      <AIMLChargingCurveClustering vehicleId={42} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-ml-charging-curve-clustering-root'),
    ).not.toBeInTheDocument();
  });

  it('TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly: renders the section when ai_mode=cloud AND ml-charging-curve-clustering toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'ml-charging-curve-clustering': true },
      }),
    );

    render(<AIMLChargingCurveClustering vehicleId={42} />);
    const root = screen.getByTestId(
      'ai-feature-ml-charging-curve-clustering-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'ml-charging-curve-clustering',
    );
  });

  it('TestMLChargingCurveClusteringAIOffUsesRuleLabelsOnly: ml-charging-curve-clustering and charging-curve-fingerprint-clustering toggles are independent (sibling distinction)', () => {
    // Both surfaces coexist on /charging/curves with independent
    // toggles. A regression that conflated the two registry
    // entries (e.g. ml-charging-curve-clustering accidentally
    // tying its visibility to charging-curve-fingerprint-clustering)
    // would surface here: with C3 ON and ML3 OFF, the ML3
    // wrapper must still be empty.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: {
          'charging-curve-fingerprint-clustering': true,
          'ml-charging-curve-clustering': false,
        },
      }),
    );

    const { container } = render(
      <AIMLChargingCurveClustering vehicleId={42} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-ml-charging-curve-clustering-root'),
    ).not.toBeInTheDocument();
  });
});
