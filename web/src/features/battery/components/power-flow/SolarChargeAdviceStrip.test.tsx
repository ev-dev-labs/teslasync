/**
 * SolarChargeAdviceStrip — independent query feedback and retained model output.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

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

const mockAdvice = vi.mocked(useSolarChargeAdvice);
const refetch = vi.fn();

function query(over: Record<string, unknown> = {}) {
  return {
    data: advice(), error: null, isError: false, isSuccess: true,
    isPending: false, isLoading: false, isFetching: false,
    fetchStatus: 'idle', refetch, dataUpdatedAt: Date.now(), ...over,
  } as ReturnType<typeof useSolarChargeAdvice>;
}

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
  mockAdvice.mockReturnValue(query());
});

describe('SolarChargeAdviceStrip', () => {
  it('renders the charge-now badge with surplus copy', () => {
    render(<SolarChargeAdviceStrip siteId={7} />);
    expect(screen.getByText('Charge now on solar')).toBeTruthy();
    expect(screen.getByText('3.00 kW surplus · ~12A solar-matched')).toBeTruthy();
  });

  it('renders the wait verdict overnight', () => {
    mockAdvice.mockReturnValue(query({ data: advice({ verdict: 'wait', surplus_w: 0, recommended_amps: 0 }) }));
    render(<SolarChargeAdviceStrip siteId={7} />);
    expect(screen.getByText('Hold for cheap rates')).toBeTruthy();
    expect(screen.getByText('0.00 kW surplus · ~0A solar-matched')).toBeTruthy();
  });

  it('keeps the advice region and model explanation for a successful empty snapshot', () => {
    mockAdvice.mockReturnValue(query({ data: advice({ verdict: 'no_data', explanation: 'No snapshot yet.' }) }));
    render(<SolarChargeAdviceStrip siteId={7} />);
    expect(screen.getByRole('region', { name: 'Solar charging advice' })).toBeTruthy();
    expect(screen.getByText('No snapshot yet.')).toBeTruthy();
    expect(screen.queryByText('Charge now on solar')).toBeNull();
  });

  it('shows source-shaped loading only during an active first fetch', () => {
    mockAdvice.mockReturnValue(query({
      data: undefined, isSuccess: false, isPending: true, isLoading: true,
      isFetching: true, fetchStatus: 'fetching',
    }));
    render(<SolarChargeAdviceStrip siteId={7} />);
    expect(screen.getByRole('status', { name: 'Loading Solar charging advice' })).toBeTruthy();
    expect(screen.queryByText(/kW surplus/)).toBeNull();
  });

  it('shows a paused first query without claiming loading or failure and retries advice', () => {
    mockAdvice.mockReturnValue(query({
      data: undefined, isSuccess: false, isPending: true, fetchStatus: 'paused',
    }));
    render(<SolarChargeAdviceStrip siteId={7} />);
    expect(screen.getByText('Refresh paused')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading Solar charging advice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the region without a site and does not invent an active fetch', () => {
    mockAdvice.mockReturnValue(query({ data: undefined, isSuccess: false, isPending: true }));
    render(<SolarChargeAdviceStrip />);
    expect(screen.getByRole('region', { name: 'Solar charging advice' })).toBeTruthy();
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('retains advice and neighbors through refresh failure, retry and recovery', () => {
    mockAdvice.mockReturnValue(query({ error: new Error('Refresh failed'), isError: true, isSuccess: false }));
    const view = () => <><TextNeighbor /><SolarChargeAdviceStrip siteId={7} /></>;
    const { rerender } = render(view());
    expect(screen.getByText('Charge now on solar')).toBeTruthy();
    expect(screen.getByText('Charge the car.')).toBeTruthy();
    expect(screen.getByTestId('stale-refresh-warning')).toBeTruthy();
    expect(screen.getByText('Neighboring live status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    mockAdvice.mockReturnValue(query({ isFetching: true, fetchStatus: 'fetching', error: new Error('Refresh failed'), isError: true }));
    rerender(view());
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeDisabled();
    expect(screen.getByText('Charge now on solar')).toBeTruthy();
    mockAdvice.mockReturnValue(query({ data: advice({ verdict: 'charge_soon', explanation: 'Solar soon.' }) }));
    rerender(view());
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    expect(screen.getByText('Charge soon')).toBeTruthy();
    expect(screen.getByText('Solar soon.')).toBeTruthy();
    expect(screen.getByText('Neighboring live status')).toBeTruthy();
  });

  it('retries initial advice failure without removing its region', () => {
    mockAdvice.mockReturnValue(query({ data: undefined, error: new Error('Unavailable'), isError: true, isSuccess: false }));
    render(<MemoryRouter><SolarChargeAdviceStrip siteId={7} /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Solar charging advice' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

function TextNeighbor() {
  return <p>Neighboring live status</p>;
}
