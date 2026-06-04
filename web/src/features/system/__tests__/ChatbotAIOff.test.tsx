// React-side AI-off contract test for the chatbot indicator.
// Mounts AIChatbotIndicator with ai_mode='off' while the feature toggle is
// on, then asserts the gated UI is absent. A cloud-mode positive control
// proves the gate itself works. The API 404 invariant is covered by the
// matching Go handler test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { AIChatbotIndicator } from '@/components/ai/AIChatbotIndicator';

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

describe('TestChatbotAIOffUsesBaselineAndAiRoute404 (chatbot-llm AI-off contract)', () => {
  it('renders nothing when ai_mode=off even with the chatbot-llm toggle on', () => {
    // The toggle is intentionally true to prove mode='off' wins over
    // a per-feature opt-in.
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { 'chatbot-llm': true } }),
    );

    const { container } = render(<AIChatbotIndicator />);

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-chatbot-llm-root'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing when ai_mode is non-off but the chatbot-llm toggle is false', () => {
    // The other half of the gate: even with mode='cloud', a
    // toggle=false MUST hide the surface (per-feature opt-in).
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { 'chatbot-llm': false } }),
    );

    const { container } = render(<AIChatbotIndicator />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId('ai-feature-chatbot-llm-root'),
    ).not.toBeInTheDocument();
  });

  it('renders the indicator when ai_mode=cloud AND chatbot-llm toggle is on (positive control)', () => {
    // Without this assertion, the off-mode assertions above are
    // trivially true (they would pass even if the indicator were
    // permanently hidden by a typo in the registry/HOC).
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { 'chatbot-llm': true } }),
    );

    render(<AIChatbotIndicator />);
    const root = screen.getByTestId('ai-feature-chatbot-llm-root');
    expect(root).toBeInTheDocument();
    expect(root).toHaveAttribute('data-ai-feature', 'chatbot-llm');
  });
});
