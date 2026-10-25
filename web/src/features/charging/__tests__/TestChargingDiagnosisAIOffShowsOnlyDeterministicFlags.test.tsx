import { appSettingsPayload } from '@/test/fixtures/appSettings'
// React-side AI-off contract for charging diagnosis. The test proves the gated
// section is absent when AI is off and present when the feature is enabled.
//
// The backend test covers 404-in-off-mode behavior; this unit test has no
// network layer. Keep the file name stable because targeted verification
// matches it by path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';





vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIChargingDiagnosis } from '@/components/ai/AIChargingDiagnosis';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test cases override `ai_mode` + `ai_features` to
// exercise the off-mode (negative) and on-mode (positive control)
// paths.
beforeEach(() => {
  mockUseSettings.mockReset();
});

describe('TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags (charging-diagnosis AI-off contract)', () => {
  it('TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags: renders nothing when ai_mode=off even with the charging-diagnosis toggle on', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". mode='off' must trump the per-feature toggle.
    //
    // The sessionId prop is also intentionally set so the absent-
    // in-DOM assertion proves that the gate (not a missing prop)
    // is what hides the section. In production the parent
    // ChargingDetailPage always passes the route's `id` param.
    mockUseSettings.mockReturnValue(
      appSettingsPayload({
        ai_mode: 'off',
        ai_features: { 'charging-diagnosis': true },
      }),
    );

    const { container } = render(<AIChargingDiagnosis sessionId="42" />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-charging-diagnosis-root'),
    ).not.toBeInTheDocument();
  });

  it('TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags: renders nothing when ai_mode is non-off but the charging-diagnosis toggle is false', () => {
    // The other half of the gate: even with mode='cloud', toggle=false must
    // hide the surface.
    mockUseSettings.mockReturnValue(
      appSettingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'charging-diagnosis': false },
      }),
    );

    const { container } = render(<AIChargingDiagnosis sessionId="42" />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-charging-diagnosis-root'),
    ).not.toBeInTheDocument();
  });

  it('TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags: renders the section when ai_mode=cloud AND charging-diagnosis toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the section were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      appSettingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'charging-diagnosis': true },
      }),
    );

    render(<AIChargingDiagnosis sessionId="42" />);
    const root = screen.getByTestId('ai-feature-charging-diagnosis-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'charging-diagnosis');
  });
});
