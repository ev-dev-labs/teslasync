// Phase-50 / 0052 — P1 PII redaction in shared exports.
//
// `TestSharedExportRedactionAIOffManualExportWorks` (the
// Vitest sibling to the Go test of the same name) is the
// slice's load-bearing AI-OFF contract proof on the React side.
// It mounts the AIPiiRedactionSharedExports component with
// ai_mode='off' (plus the per-feature toggle on, to defeat the
// obvious "off because nothing is enabled" path) and asserts:
//
//   1. The AI section's rooted test ID is absent from the DOM.
//   2. The wrapper renders no children (empty container).
//   3. With ai_mode='cloud' AND
//      pii-redaction-shared-exports=true, the section IS
//      present + carries the expected test ID. This is the
//      positive control that proves the gate actually works
//      (otherwise the "absent in off mode" assertion is
//      trivially true).
//
// The HTTP POST /api/v1/ai/exports/redaction/draft
// 404-in-off-mode invariant is proven by the Go-side
// TestSharedExportRedactionAIOffManualExportWorks in
// internal/api/ai_pii_redaction_shared_exports_handler_test.go
// — the network layer does not exist in the React unit-test
// scope. The "manual export works" semantic refers to the
// parent ExportsPage, which keeps rendering the deterministic
// export-jobs list, bulk-delete toolbar, and download links
// regardless of this AI section's visibility (ADR-015 §I3).
//
// File name MUST stay
// `TestSharedExportRedactionAIOffManualExportWorks.test.tsx`
// — the slice prompt's verification command runs
// `vitest --run TestSharedExportRedactionAIOffManualExportWorks`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIPiiRedactionSharedExports } from '@/components/ai/AIPiiRedactionSharedExports';

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

describe('TestSharedExportRedactionAIOffManualExportWorks (pii-redaction-shared-exports AI-off contract)', () => {
  it('TestSharedExportRedactionAIOffManualExportWorks: renders nothing when ai_mode=off even with the pii-redaction-shared-exports toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    );

    const { container } = render(<AIPiiRedactionSharedExports />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-pii-redaction-shared-exports-root'),
    ).not.toBeInTheDocument();
  });

  it('TestSharedExportRedactionAIOffManualExportWorks: renders nothing when ai_mode is non-off but the pii-redaction-shared-exports toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': false },
      }),
    );

    const { container } = render(<AIPiiRedactionSharedExports />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-pii-redaction-shared-exports-root'),
    ).not.toBeInTheDocument();
  });

  it('TestSharedExportRedactionAIOffManualExportWorks: renders the section when ai_mode=cloud AND pii-redaction-shared-exports toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above
    // are trivially true (they would pass even if the section
    // were permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'pii-redaction-shared-exports': true },
      }),
    );

    render(<AIPiiRedactionSharedExports />);
    const root = screen.getByTestId(
      'ai-feature-pii-redaction-shared-exports-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'pii-redaction-shared-exports',
    );
  });
});
