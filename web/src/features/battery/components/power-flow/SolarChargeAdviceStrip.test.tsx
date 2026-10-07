/**
 * SolarChargeAdviceStrip — verdict badge + surplus copy; silent on no_data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { SolarChargeAdvice } from '@/types/energy';

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

vi.mock('@/api/hooks/useEnergy', () => ({ useSolarChargeAdvice: vi.fn() }));

import { useSolarChargeAdvice } from '@/api/hooks/useEnergy';
import { SolarChargeAdviceStrip } from './SolarChargeAdviceStrip';

const mockAdvice = useSolarChargeAdvice as unknown as ReturnType<typeof vi.fn>;

function advice(over: Partial<SolarChargeAdvice> = {}): SolarChargeAdvice {
  return {
    verdict: 'charge_now',
    surplus_w: 3000,
    solar_w: 6000,
    home_w: 1000,
    battery_charge_w: 2000,
    recommended_amps: 12,
    snapshot_age_s: 60,
    explanation: 'Charge the car.',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdvice.mockReturnValue({ data: advice() });
});

describe('SolarChargeAdviceStrip', () => {
  it('renders the charge-now badge with surplus copy', () => {
    render(<SolarChargeAdviceStrip siteId={7} />);
    expect(screen.getByText('Charge now on solar')).toBeTruthy();
    expect(screen.getByText('3.0 kW surplus · ~12A solar-matched')).toBeTruthy();
  });

  it('renders the wait verdict overnight', () => {
    mockAdvice.mockReturnValue({ data: advice({ verdict: 'wait', surplus_w: 0, recommended_amps: 0 }) });
    render(<SolarChargeAdviceStrip siteId={7} />);
    expect(screen.getByText('Hold for cheap rates')).toBeTruthy();
  });

  it('renders nothing when there is no snapshot', () => {
    mockAdvice.mockReturnValue({ data: advice({ verdict: 'no_data' }) });
    const { container } = render(<SolarChargeAdviceStrip siteId={7} />);
    expect(container.textContent).toBe('');
  });
});
