// Phase-50 / 0024 — D4 Auto trip naming.
//
// `TestAutoTripNamingAIOffHidesSuggestionButton` (the Vitest sibling
// to the Go test of the same name) is the slice's load-bearing
// AI-OFF contract proof on the React side. It mounts the
// AIAutoTripNameSuggestion component with ai_mode='off' (plus the
// per-feature toggle on, to defeat the obvious "off because nothing
// is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND auto-trip-naming=true, the section
//      IS present + carries the expected test ID. This is the
//      positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//
// The HTTP /api/v1/ai/trips/{tripID}/name/draft 404-in-off-mode
// invariant is proven by the Go-side
// TestAutoTripNamingAIOffHidesSuggestionButton in
// internal/api/ai_auto_trip_name_handler_test.go — the network
// layer does not exist in the React unit-test scope. The "hides
// suggestion button" semantic refers to the parent TripDetailPage
// which keeps rendering the deterministic stat cards + KVList of
// trip metadata + drive list + manual trip-name field regardless
// of this AI section's visibility.
//
// File name MUST stay
// `TestAutoTripNamingAIOffHidesSuggestionButton.test.tsx` — the
// slice prompt's verification command runs
// `vitest --run TestAutoTripNamingAIOffHidesSuggestionButton`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIAutoTripNameSuggestion } from '@/components/ai/AIAutoTripNameSuggestion';

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

describe('TestAutoTripNamingAIOffHidesSuggestionButton (auto-trip-naming AI-off contract)', () => {
  it('TestAutoTripNamingAIOffHidesSuggestionButton: renders nothing when ai_mode=off even with the auto-trip-naming toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag is
    // off". The mode='off' check MUST trump the per-feature toggle
    // (ADR-015 §I7).
    //
    // The tripId prop is also intentionally set so the
    // absent-in-DOM assertion proves that the gate (not a missing
    // prop) is what hides the section. In production the parent
    // TripDetailPage always passes the currently selected trip's
    // id from useParams.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'auto-trip-naming': true },
      }),
    );

    const { container } = render(<AIAutoTripNameSuggestion tripId="42" />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-auto-trip-naming-root'),
    ).not.toBeInTheDocument();
  });

  it('TestAutoTripNamingAIOffHidesSuggestionButton: renders nothing when ai_mode is non-off but the auto-trip-naming toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-trip-naming': false },
      }),
    );

    const { container } = render(<AIAutoTripNameSuggestion tripId="42" />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-auto-trip-naming-root'),
    ).not.toBeInTheDocument();
  });

  it('TestAutoTripNamingAIOffHidesSuggestionButton: renders the section when ai_mode=cloud AND auto-trip-naming toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'auto-trip-naming': true },
      }),
    );

    render(<AIAutoTripNameSuggestion tripId="42" />);
    const root = screen.getByTestId('ai-feature-auto-trip-naming-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'auto-trip-naming');
  });
});
