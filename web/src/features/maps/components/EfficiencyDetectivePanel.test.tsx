/**
 * EfficiencyDetectivePanel — verdict badges + attribution detail.
 * `useEfficiencyShift` is mocked; GlassPanel/Badge render for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  it('keeps a selected vehicle awaiting its first connection distinct from resolved empty data and offers recovery', () => {
    const refetch = vi.fn();
    mockShift.mockReturnValue({
      data: undefined, isLoading: false, isPending: true, isSuccess: false,
      isError: false, error: null, fetchStatus: 'paused', refetch,
    });
    const { rerender } = render(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Waiting for a connection before this source can load. Missing evidence remains unknown.',
    );
    expect(screen.queryByText('Select a vehicle to diagnose efficiency shifts.')).not.toBeInTheDocument();
    expect(screen.queryByText('No efficiency data available yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    mockShift.mockReturnValue({
      data: null, isLoading: false, isPending: false, isSuccess: true,
      isError: false, error: null, fetchStatus: 'idle', refetch,
    });
    rerender(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByText('No efficiency data available yet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Select a vehicle to diagnose efficiency shifts.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(2);

    mockShift.mockReturnValue({
      data: null, isLoading: false, isPending: false, isSuccess: true,
      isError: false, error: null, fetchStatus: 'paused', refetch,
    });
    rerender(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByText('No efficiency data available yet')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('does not call an unresolved idle request empty', () => {
    mockShift.mockReturnValue({
      data: undefined, isLoading: false, isPending: true, isSuccess: false,
      isError: false, error: null, fetchStatus: 'idle', refetch: vi.fn(),
    });
    render(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByRole('status')).toHaveTextContent('No requested source has returned usable data yet.');
    expect(screen.queryByText('No efficiency data available yet')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps the disabled no-vehicle prerequisite without requesting an unscoped diagnosis', () => {
    const refetch = vi.fn();
    mockShift.mockReturnValue({
      data: undefined, isLoading: false, isPending: true, isSuccess: false,
      isError: false, error: null, fetchStatus: 'idle', refetch,
    });
    render(<EfficiencyDetectivePanel vehicleId="" />);
    expect(mockShift).toHaveBeenCalledWith('');
    expect(screen.getByText('Select a vehicle to diagnose efficiency shifts.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('keeps active first-load skeletons distinct from empty and blocked data', () => {
    mockShift.mockReturnValue({
      data: undefined, isLoading: true, isPending: true, isSuccess: false,
      isError: false, error: null, fetchStatus: 'fetching', refetch: vi.fn(),
    });
    render(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByRole('status', { name: 'Loading Efficiency detective' })).toBeInTheDocument();
    expect(screen.queryByText('No efficiency data available yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('preserves fatal Retry without claiming that the response was empty', () => {
    const refetch = vi.fn();
    mockShift.mockReturnValue({
      data: undefined, isLoading: false, isError: true,
      error: new Error('initial load failed'), refetch,
    });
    render(<EfficiencyDetectivePanel vehicleId="4" />);
    expect(screen.getByText('Efficiency diagnosis could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No efficiency data available yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each(['failed', 'paused'] as const)('preserves retained diagnosis, its signed detail and Retry during a %s refresh', (refresh) => {
    const data = Object.freeze(shift());
    const original = JSON.stringify(data);
    const refetch = vi.fn();
    mockShift.mockReturnValue({
      data, isLoading: false, isError: refresh === 'failed',
      error: refresh === 'failed' ? new Error('refresh failed') : null,
      fetchStatus: refresh === 'paused' ? 'paused' : 'idle', refetch,
    });
    render(<MemoryRouter><EfficiencyDetectivePanel vehicleId="4" /></MemoryRouter>);
    expect(screen.getByText(data.explanation)).toBeInTheDocument();
    expect(screen.getByText('Colder weather')).toBeInTheDocument();
    // Face-value disclosure: the face shows live values only.
    expect(screen.getByText('15.00%')).toBeInTheDocument();
    expect(screen.getByText('12.00%')).toBeInTheDocument();
    expect(screen.getByText('-8.00°C')).toBeInTheDocument();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument();
    // The signed detail moved to the Review-details drawer.
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Month-over-month diagnosis details' });
    expect(within(drawer).getAllByText('15.00% vs prior month · 12.00% temperature-attributed · -8.00°C shift').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(data)).toBe(original);
  });

  it('uses the existing muted ink for the decorative bulb without replacing the verdict status', () => {
    const { container } = render(<EfficiencyDetectivePanel vehicleId="4" />);
    const bulb = container.querySelector('.lucide-lightbulb');
    expect(bulb).toHaveClass('text-[var(--text-muted)]');
    expect(bulb).not.toHaveClass('text-cyan-300');
    expect(bulb).toHaveAttribute('aria-hidden', 'true');
    expect(bulb).toHaveAttribute('focusable', 'false');
    expect(screen.getByText('Colder weather')).toBeInTheDocument();
  });

  it('opens the real monthly-details drawer with signed source Celsius shift and retained server explanation', () => {
    mockShift.mockReturnValue({
      data: shift(), isLoading: false, isError: true, error: new Error('refresh failed'), refetch: vi.fn(),
    });
    render(<MemoryRouter><EfficiencyDetectivePanel vehicleId="4" /></MemoryRouter>);
    expect(screen.getByText('Efficiency worsened and colder weather explains it.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Month-over-month diagnosis details' });
    expect(within(drawer).getByText('-8.00°C')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/2025-12 versus 2025-11/).length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Temperature difference in source degrees Celsius, not an absolute temperature conversion.')).toBeInTheDocument();
  });
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
