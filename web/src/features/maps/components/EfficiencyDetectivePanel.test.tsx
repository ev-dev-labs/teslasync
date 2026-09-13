/**
 * EfficiencyDetectivePanel — verdict badges + attribution detail.
 * `useEfficiencyShift` is mocked; GlassPanel/Badge render for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { EfficiencyShift } from '@/api/hooks/useAnalytics';

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') return interpolate(second, third as Record<string, unknown> | undefined);
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/api/hooks/useAnalytics', () => ({ useEfficiencyShift: vi.fn() }));

import { useEfficiencyShift } from '@/api/hooks/useAnalytics';
import { EfficiencyDetectivePanel } from './EfficiencyDetectivePanel';

const mockShift = useEfficiencyShift as unknown as ReturnType<typeof vi.fn>;

function shift(over: Partial<EfficiencyShift> = {}): EfficiencyShift {
  return {
    latest_month: '2025-12',
    prior_month: '2025-11',
    latest_efficiency: 23,
    prior_efficiency: 20,
    efficiency_delta_pct: 15,
    latest_temp_c: 2,
    prior_temp_c: 10,
    temp_delta_c: -8,
    temp_sensitivity_per_c: -0.3,
    temp_attributed_pct: 12,
    residual_pct: 3,
    verdict: 'colder_weather',
    explanation: 'Efficiency worsened and colder weather explains it.',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockShift.mockReturnValue({ data: shift(), isLoading: false, isError: false, error: null, refetch: vi.fn() });
});

describe('EfficiencyDetectivePanel', () => {
  it('renders the verdict badge and explanation', () => {
    render(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByText('Colder weather')).toBeTruthy();
    expect(screen.getByText('Efficiency worsened and colder weather explains it.')).toBeTruthy();
  });

  it('renders the driving-pattern verdict when temperature cannot explain the move', () => {
    mockShift.mockReturnValue({
      data: shift({ verdict: 'driving_pattern', explanation: 'Check tire pressure.' }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByText('Driving pattern')).toBeTruthy();
    expect(screen.getByText('Check tire pressure.')).toBeTruthy();
  });

  it('hides the attribution detail when data is insufficient', () => {
    mockShift.mockReturnValue({
      data: shift({ verdict: 'insufficient_data', explanation: 'Need at least two months.' }),
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByText('Need more data')).toBeTruthy();
    expect(screen.queryByText(/temperature-attributed/)).toBeNull();
  });
});
