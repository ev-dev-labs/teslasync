// Phase-50 / 0001 — F0 AI-Off Contract.
//
// Unit tests for `useAiEnabled`. Exercises every state path that
// must yield `false` to satisfy ADR-015's fail-closed posture, plus
// the single positive path. The hook composes `useSettings`, so we
// mock the lower hook directly rather than threading a QueryClient
// + mocked transport through every test — that strategy is well-
// trodden in this repo (see `useFormatting.test.tsx` and
// `useUnits.test.tsx`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { AppSettings } from '@/api/types';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import { useSettings } from '@/hooks/useSettings';
import { useAiEnabled } from '@/hooks/useAiEnabled';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

function settingsPayload(partial: Partial<AppSettings>): { settings: AppSettings } {
  const base: AppSettings = {
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
  return { settings: { ...base, ...partial } };
}

beforeEach(() => {
  mockUseSettings.mockReset();
});

describe('useAiEnabled — ADR-015 fail-closed paths', () => {
  it('returns false when settings have not yet resolved', () => {
    // The real useSettings returns `{ settings: defaults }` even
    // before the network fetches, because the hook initialises
    // from local defaults. Simulate the rare "undefined" case to
    // assert fail-closed nonetheless.
    mockUseSettings.mockReturnValue({ settings: undefined });
    const { result } = renderHook(() => useAiEnabled('chatbot-llm'));
    expect(result.current).toBe(false);
  });

  it('returns false when ai_mode is the default off', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'off', ai_features: { 'chatbot-llm': true } }),
    );
    const { result } = renderHook(() => useAiEnabled('chatbot-llm'));
    expect(result.current).toBe(false);
  });

  it('returns false when ai_mode is omitted (undefined)', () => {
    mockUseSettings.mockReturnValue(settingsPayload({}));
    const { result } = renderHook(() => useAiEnabled('chatbot-llm'));
    expect(result.current).toBe(false);
  });

  it('returns false in mode=local when the per-feature flag is missing', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'local', ai_features: {} }));
    const { result } = renderHook(() => useAiEnabled('chatbot-llm'));
    expect(result.current).toBe(false);
  });

  it('returns false in mode=cloud when the per-feature flag is explicitly false', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud', ai_features: { 'chatbot-llm': false } }),
    );
    const { result } = renderHook(() => useAiEnabled('chatbot-llm'));
    expect(result.current).toBe(false);
  });

  it('returns false when ai_features is omitted entirely', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'local' }));
    const { result } = renderHook(() => useAiEnabled('chatbot-llm'));
    expect(result.current).toBe(false);
  });

  it('returns true only when mode != off AND the per-feature flag is true', () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'local', ai_features: { 'chatbot-llm': true } }),
    );
    const { result } = renderHook(() => useAiEnabled('chatbot-llm'));
    expect(result.current).toBe(true);
  });
});
