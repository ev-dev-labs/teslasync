// React-side AI-off contract for cabin temperature narration. The AI section
// is absent when AI is off, while deterministic charts remain the baseline.
//
// The backend test covers 404-in-off-mode behavior; this unit test has no
// network layer. Keep the file name stable because targeted verification
// matches it by path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AICabinTemperatureImpactNarrative } from '@/components/ai/AICabinTemperatureImpactNarrative';

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

describe('TestCabinTemperatureNarrativeAIOffShowsChartsOnly (cabin-temperature-impact-narrative AI-off contract)', () => {
  it('TestCabinTemperatureNarrativeAIOffShowsChartsOnly: renders nothing when ai_mode=off even with the cabin-temperature-impact-narrative toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". mode='off' must trump the per-feature toggle.
    //
    // The vehicleId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a missing
    // prop) is what hides the section. In production the parent
    // TemperatureImpactPage always passes the currently selected
    // vehicle's id from the active-vehicle context.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'cabin-temperature-impact-narrative': true },
      }),
    );

    const { container } = render(<AICabinTemperatureImpactNarrative vehicleId={42} />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-cabin-temperature-impact-narrative-root'),
    ).not.toBeInTheDocument();
  });

  it('TestCabinTemperatureNarrativeAIOffShowsChartsOnly: renders nothing when ai_mode is non-off but the cabin-temperature-impact-narrative toggle is false', () => {
    // The other half of the gate: even with mode='cloud', toggle=false must
    // hide the surface.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cabin-temperature-impact-narrative': false },
      }),
    );

    const { container } = render(<AICabinTemperatureImpactNarrative vehicleId={42} />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-cabin-temperature-impact-narrative-root'),
    ).not.toBeInTheDocument();
  });

  it('TestCabinTemperatureNarrativeAIOffShowsChartsOnly: renders the section when ai_mode=cloud AND cabin-temperature-impact-narrative toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'cabin-temperature-impact-narrative': true },
      }),
    );

    render(<AICabinTemperatureImpactNarrative vehicleId={42} />);
    const root = screen.getByTestId('ai-feature-cabin-temperature-impact-narrative-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'cabin-temperature-impact-narrative');
  });
});
