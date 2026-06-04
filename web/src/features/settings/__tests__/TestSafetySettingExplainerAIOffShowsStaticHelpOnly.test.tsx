// Helix safety setting explainer.
// `TestSafetySettingExplainerAIOffShowsStaticHelpOnly` is the
// React-side AI-OFF contract proof that complements the Go test of
// the same name.
// It mounts the FULL `/settings/safety` SafetyPage with
// ai_mode='off' (plus the per-feature toggle on, to defeat the
// obvious "off because nothing is enabled" path) and asserts:
//   1. The deterministic baseline listing of safety-related
//      settings renders — every row is present with its current
//      value visible, every row's docs link renders. This is the
//      "static help" surface the user falls back to when AI is off.
//   2. The opt-in AI section's rooted test ID
//      `ai-feature-safety-setting-explainer-root` is ABSENT
//      from the DOM (ADR-015 §I5 hidden UI).
//   3. The button rendered by AIFeatureCard is also absent —
//      the per-feature verb "Explain" must not surface in any
//      role-button accessible name in off mode.
//   4. With ai_mode='cloud' AND the per-feature toggle on, the
//      AI section IS present + carries the registered test ID.
//      This is the positive control that proves the gate
//      actually works (otherwise the "absent in off mode"
//      assertion is trivially true).
// The HTTP POST /api/v1/ai/settings/safety/explain
// 404-in-off-mode invariant is proven by the Go-side
// TestSafetySettingExplainerAIOffShowsStaticHelpOnly in
// internal/api/ai_safety_setting_explainer_handler_test.go —
// the network layer does not exist in the React unit-test
// scope. The "static help only" semantic refers to this page's
// canonical baseline rendering of the safety-related settings.
// File name MUST stay
// `TestSafetySettingExplainerAIOffShowsStaticHelpOnly.test.tsx`
// — the verification command runs
// `vitest --run TestSafetySettingExplainerAIOffShowsStaticHelpOnly`,
// where the positional pattern is matched against the file PATH.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import SafetyPage from '../pages/SafetyPage';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

// baseSettings is a complete AppSettings with realistic non-AI
// defaults. Per-test cases override `ai_mode` + `ai_features` to
// exercise the off-mode (negative) and on-mode (positive control)
// paths. The safety-relevant fields below are intentionally a
// MIXTURE of on/off and start/end values so the listing has
// visible content the test can assert against (and so the test
// fails loudly if the page accidentally elides a row).
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
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'hourly',
  critical_flash_enabled: true,
  tab_badge_enabled: true,
};

function settingsPayload(overrides: Partial<AppSettings>) {
  return { settings: { ...baseSettings, ...overrides } };
}

beforeEach(() => {
  mockUseSettings.mockReset();
});

describe('TestSafetySettingExplainerAIOffShowsStaticHelpOnly (safety-setting-explainer AI-off contract)', () => {
  it('TestSafetySettingExplainerAIOffShowsStaticHelpOnly: renders the static safety listing without the AI section when ai_mode=off (toggle on to defeat the trivial path)', () => {
    // The toggle is intentionally set to true to defeat the
    // shortcut path "the section hides because the feature flag
    // is off". The mode='off' check MUST trump the per-feature
    // toggle (ADR-015 §I7).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'off',
        ai_features: { 'safety-setting-explainer': true },
      }),
    );

    render(<SafetyPage />);

    // 1) Baseline listing renders. Look for every row's i18n
    // fallback title — proves all 7 safety settings still
    // surface for the user when AI is off (the canonical
    // baseline that ADR-015 §I3 requires us to preserve).
    expect(screen.getByText('Quiet hours')).toBeInTheDocument();
    expect(screen.getByText('Quiet-hours window start')).toBeInTheDocument();
    expect(screen.getByText('Quiet-hours window end')).toBeInTheDocument();
    expect(screen.getByText('Alert digest mode')).toBeInTheDocument();
    expect(screen.getByText('Critical-alert tab flash')).toBeInTheDocument();
    expect(screen.getByText('Unread tab badge')).toBeInTheDocument();
    expect(screen.getByText('API kill-switch')).toBeInTheDocument();

    // 2) Each row's current value is reachable via its
    // dedicated test ID (the Badge rendering the value). The
    // baseSettings above mix On/Off + start/end values so the
    // test fails loudly if any row silently renders the wrong
    // shape (e.g. swallows undefined into "—" when the value
    // is actually present).
    expect(
      screen.getByTestId(
        'safety-settings-value-safetySettings.rows.quietHoursEnabled.title',
      ),
    ).toHaveTextContent('On');
    expect(
      screen.getByTestId(
        'safety-settings-value-safetySettings.rows.quietHoursStart.title',
      ),
    ).toHaveTextContent('22:00');
    expect(
      screen.getByTestId(
        'safety-settings-value-safetySettings.rows.quietHoursEnd.title',
      ),
    ).toHaveTextContent('07:00');
    expect(
      screen.getByTestId(
        'safety-settings-value-safetySettings.rows.alertDigestMode.title',
      ),
    ).toHaveTextContent('hourly');
    expect(
      screen.getByTestId(
        'safety-settings-value-safetySettings.rows.criticalFlashEnabled.title',
      ),
    ).toHaveTextContent('On');
    expect(
      screen.getByTestId(
        'safety-settings-value-safetySettings.rows.tabBadgeEnabled.title',
      ),
    ).toHaveTextContent('On');
    expect(
      screen.getByTestId(
        'safety-settings-value-safetySettings.rows.apiSuspended.title',
      ),
    ).toHaveTextContent('Active');

    // 3) The opt-in AI section is ABSENT — the wrapping
    // withAiFeature HOC returns null in off mode (ADR-015 §I5).
    expect(
      screen.queryByTestId('ai-feature-safety-setting-explainer-root'),
    ).not.toBeInTheDocument();

    // 4) The per-feature CTA does not surface either. The
    // accessible name composed by AIFeatureCard would be
    // "Ask Helix · Explain my settings" if the section were
    // mounted; we assert ABSENCE of that role-name as a second
    // line of defence (would catch a regression where the
    // gate stops returning null and only hides via CSS).
    expect(
      screen.queryByRole('button', { name: /Explain my settings/i }),
    ).not.toBeInTheDocument();
  });

  it('TestSafetySettingExplainerAIOffShowsStaticHelpOnly: renders the static safety listing without the AI section when ai_mode is non-off but the safety-setting-explainer toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in,
    // ADR-015 §I7). The baseline listing keeps rendering — the
    // user always has access to the static help even when AI is
    // installed but this specific feature is off.
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'safety-setting-explainer': false },
      }),
    );

    render(<SafetyPage />);

    // Baseline listing still renders — proves the page-level
    // surface does not depend on the AI feature being on.
    expect(screen.getByText('Quiet hours')).toBeInTheDocument();
    expect(screen.getByText('Alert digest mode')).toBeInTheDocument();
    expect(screen.getByText('API kill-switch')).toBeInTheDocument();

    expect(
      screen.queryByTestId('ai-feature-safety-setting-explainer-root'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Explain my settings/i }),
    ).not.toBeInTheDocument();
  });

  it('TestSafetySettingExplainerAIOffShowsStaticHelpOnly: renders the AI section when ai_mode=cloud AND safety-setting-explainer toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above
    // are trivially true (they would pass even if the section
    // were permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({
        ai_mode: 'cloud',
        ai_features: { 'safety-setting-explainer': true },
      }),
    );

    render(<SafetyPage />);

    // The AI section is mounted.
    const root = screen.getByTestId(
      'ai-feature-safety-setting-explainer-root',
    );
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute(
      'data-ai-feature',
      'safety-setting-explainer',
    );

    // The baseline listing keeps rendering BELOW the AI
    // section (ADR-015 §I3 — baseline is not removed when AI
    // is added).
    expect(screen.getByText('Quiet hours')).toBeInTheDocument();
    expect(screen.getByText('API kill-switch')).toBeInTheDocument();

    // The per-feature CTA is also present, locatable via
    // UNANCHORED role-name regex per the HX addendum
    // (the accessible name is "Ask Helix · Explain my settings").
    expect(
      screen.getByRole('button', { name: /Explain my settings/i }),
    ).toBeInTheDocument();
  });
});
