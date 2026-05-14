// Phase-50 / 0021 — D1 Natural-language drive search and replay.
//
// `TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly` (the Vitest
// sibling to the Go test of the same name) is the slice's
// load-bearing AI-OFF contract proof on the React side. It mounts
// the AINLDriveSearch component with ai_mode='off' (plus the
// per-feature toggle on, to defeat the obvious "off because
// nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND nl-drive-search-replay=true, the
//      section IS present + carries the expected test ID. This is
//      the positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is trivially
//      true).
//
// The HTTP POST /api/v1/ai/drives/search 404-in-off-mode invariant
// + the typed GET /api/v1/drives baseline-coexistence invariant
// are proven by the Go-side
// TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly in
// internal/api/ai_drive_search_handler_test.go — the network layer
// does not exist in the React unit-test scope. The DrivesListPage
// keeps rendering its full SearchInput + FilterBar + RangePicker +
// VehicleSelect baseline regardless of the AI toggle; the AI side
// panel is the ONLY surface this test is responsible for.
//
// File name MUST stay
// `TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly.test.tsx` —
// the slice prompt's verification command runs
// `vitest --run TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AINLDriveSearch } from '@/components/ai/AINLDriveSearch';

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

describe('TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly (nl-drive-search-replay AI-off contract)', () => {
  it('TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly: renders nothing when ai_mode=off even with the nl-drive-search-replay toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7). The typed DrivesListPage filters
    // (SearchInput + FilterBar + RangePicker + VehicleSelect)
    // are completely unaffected — this assertion only proves
    // that the AI surface is absent; the typed surface lives
    // outside the AINLDriveSearch component tree.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'nl-drive-search-replay': true },
      }),
    );

    const { container } = render(<AINLDriveSearch />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-nl-drive-search-replay-root'),
    ).not.toBeInTheDocument();
  });

  it('TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly: renders nothing when ai_mode is non-off but the nl-drive-search-replay toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-drive-search-replay': false },
      }),
    );

    const { container } = render(<AINLDriveSearch />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-nl-drive-search-replay-root'),
    ).not.toBeInTheDocument();
  });

  it('TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly: renders the section when ai_mode=cloud AND nl-drive-search-replay toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'nl-drive-search-replay': true },
      }),
    );

    render(<AINLDriveSearch />);
    const root = screen.getByTestId('ai-feature-nl-drive-search-replay-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'nl-drive-search-replay');
  });
});
