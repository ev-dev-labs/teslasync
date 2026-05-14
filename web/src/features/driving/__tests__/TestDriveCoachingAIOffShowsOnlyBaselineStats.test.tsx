// Phase-50 / 0018 — N4 Per-drive coaching narrative.
//
// `TestDriveCoachingAIOffShowsOnlyBaselineStats` (the Vitest
// sibling to the Go test of the same name) is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AIDriveCoaching component with ai_mode='off' (plus the
// per-feature toggle on, to defeat the obvious "off because nothing
// is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND drive-coaching=true, the section
//      IS present + carries the expected test ID. This is the
//      positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//
// The HTTP /api/v1/ai/drives/{driveID}/coach 404-in-off-mode
// invariant is proven by the Go-side
// TestDriveCoachingAIOffShowsOnlyBaselineStats in
// internal/api/ai_drive_coach_handler_test.go — the network layer
// does not exist in the React unit-test scope.
//
// File name MUST stay
// `TestDriveCoachingAIOffShowsOnlyBaselineStats.test.tsx` — the
// slice prompt's verification command runs
// `vitest --run TestDriveCoachingAIOffShowsOnlyBaselineStats`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIDriveCoaching } from '@/components/ai/AIDriveCoaching';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// baseSettings is a complete AppSettings with realistic non-AI defaults.
// Per-test cases override `ai_mode` + `ai_features` to exercise the
// off-mode (negative) and on-mode (positive control) paths.
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

describe('TestDriveCoachingAIOffShowsOnlyBaselineStats (drive-coaching AI-off contract)', () => {
  it('TestDriveCoachingAIOffShowsOnlyBaselineStats: renders nothing when ai_mode=off even with the drive-coaching toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    //
    // The driveId prop is also intentionally set so the absent-in-
    // DOM assertion proves that the gate (not a missing prop) is
    // what hides the section. In production the parent
    // DriveDetailPage always passes the route's `id` param.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'drive-coaching': true },
      }),
    );

    const { container } = render(<AIDriveCoaching driveId="42" />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-drive-coaching-root'),
    ).not.toBeInTheDocument();
  });

  it('TestDriveCoachingAIOffShowsOnlyBaselineStats: renders nothing when ai_mode is non-off but the drive-coaching toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'drive-coaching': false },
      }),
    );

    const { container } = render(<AIDriveCoaching driveId="42" />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-drive-coaching-root'),
    ).not.toBeInTheDocument();
  });

  it('TestDriveCoachingAIOffShowsOnlyBaselineStats: renders the section when ai_mode=cloud AND drive-coaching toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'drive-coaching': true },
      }),
    );

    render(<AIDriveCoaching driveId="42" />);
    const root = screen.getByTestId('ai-feature-drive-coaching-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'drive-coaching');
  });
});
