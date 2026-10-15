/**
 * SilenceBanner — surfaces quiet/silent/never; hides on ok.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { VehicleSilence } from '@/api/hooks/useVehicles';
import type { DataStateSource } from '@/api/dataState';

const { mockSilence } = vi.hoisted(() => ({
  mockSilence: vi.fn<() => DataStateSource<VehicleSilence | null>>(),
}));

vi.mock('react-i18next', () => {
  const t = (key: string, second?: unknown): string =>
    typeof second === 'string' ? second : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicleSilence: mockSilence }));

import { SilenceBanner } from './SilenceBanner';

function silence(over: Partial<VehicleSilence> = {}): VehicleSilence {
  return {
    vehicle_id: 3,
    status: 'silent',
    last_seen_at: '2026-03-09T06:00:00Z',
    silent_for_s: 108000,
    checked_at: '2026-03-10T12:00:00Z',
    explanation: 'Silent for 30h.',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSilence.mockReturnValue({ data: silence(), isSuccess: true, fetchStatus: 'idle' });
});

describe('SilenceBanner', () => {
  it('renders the silent banner with guidance', () => {
    render(<SilenceBanner vehicleId={3} />);
    expect(screen.getByText('Vehicle silent')).toBeTruthy();
    expect(screen.getByText('Silent for 30h.')).toBeTruthy();
  });

  it('renders nothing when telemetry is fresh', () => {
    mockSilence.mockReturnValue({ data: silence({ status: 'ok', explanation: 'fresh' }) });
    const { container } = render(<SilenceBanner vehicleId={3} />);
    expect(container.textContent).toBe('');
  });

  it('shows active initial loading instead of implying healthy telemetry', () => {
    mockSilence.mockReturnValue({ isPending: true, isLoading: true, fetchStatus: 'fetching' });
    render(<SilenceBanner vehicleId={3} />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('No telemetry yet')).toBeNull();
  });

  it('shows paused without data without asserting loading, failure, or vehicle silence', () => {
    mockSilence.mockReturnValue({ isPending: true, fetchStatus: 'paused' });
    render(<SilenceBanner vehicleId={3} />);
    expect(screen.getByText('Refresh paused')).toBeTruthy();
    expect(screen.queryByText('Vehicle silent')).toBeNull();
    // The paused notice is itself a status; no loading status is announced.
    expect(screen.queryAllByRole('status').every((status) => !/loading/i.test(status.textContent ?? ''))).toBe(true);
  });

  it.each([undefined, null])('shows an unavailable successful empty watchdog (%s)', (data) => {
    mockSilence.mockReturnValue({ data, isSuccess: true, fetchStatus: 'idle' });
    render(<SilenceBanner vehicleId={3} />);
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeTruthy();
    expect(screen.queryByText('No telemetry yet')).toBeNull();
  });

  it('preserves an authoritative never result with zero elapsed silence', () => {
    mockSilence.mockReturnValue({
      data: silence({ status: 'never', silent_for_s: 0, last_seen_at: null, explanation: '' }),
      isSuccess: true,
    });
    render(<SilenceBanner vehicleId={3} />);
    expect(screen.getByText('No telemetry yet')).toBeTruthy();
  });

  it('offers retry for initial failure rather than hiding the watchdog', () => {
    const refetch = vi.fn();
    mockSilence.mockReturnValue({ error: new Error('Watchdog failed'), isError: true, refetch });
    render(<SilenceBanner vehicleId={3} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText('Vehicle silent')).toBeNull();
  });

  it.each(['silent', 'ok'] as const)('qualifies retained %s after refresh failure and clears feedback on recovery', (status) => {
    const refetch = vi.fn();
    const data = silence({ status });
    mockSilence.mockReturnValue({
      data, error: new Error('Refresh failed'), isError: true,
      dataUpdatedAt: Date.now() - 60_000, refetch,
    });
    const { rerender, container } = render(<SilenceBanner vehicleId={3} />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeTruthy();
    if (status === 'silent') expect(screen.getByText('Silent for 30h.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();

    mockSilence.mockReturnValue({ data, isSuccess: true, fetchStatus: 'idle', dataUpdatedAt: Date.now(), refetch });
    rerender(<SilenceBanner vehicleId={3} />);
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    if (status === 'ok') expect(container.textContent).toBe('');
    else expect(screen.getByText('Vehicle silent')).toBeTruthy();
  });

  it('qualifies a retained ok check when refresh is paused', () => {
    mockSilence.mockReturnValue({ data: silence({ status: 'ok' }), fetchStatus: 'paused' });
    render(<SilenceBanner vehicleId={3} />);
    expect(screen.getByTestId('stale-refresh-warning').getAttribute('data-refresh-blocked')).toBe('true');
    expect(screen.queryByText('Vehicle silent')).toBeNull();
  });
});
