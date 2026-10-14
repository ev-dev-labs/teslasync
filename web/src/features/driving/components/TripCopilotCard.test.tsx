/**
 * TripCopilotCard — verdict badges + payload wiring. `useTripConfidence`
 * is mocked; GlassPanel/Badge render for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { TripConfidence, TripConfidenceRequest } from '@/types/driving';

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

vi.mock('@/api/hooks/useDriving', () => ({ useTripConfidence: vi.fn() }));

import { useTripConfidence } from '@/api/hooks/useDriving';
import { TripCopilotCard } from './TripCopilotCard';

const mockConfidence = useTripConfidence as unknown as ReturnType<typeof vi.fn>;

function verdict(over: Partial<TripConfidence> = {}): TripConfidence {
  return {
    arrival_soc: 48,
    usable_kwh: 60,
    needed_kwh: 24,
    margin_kwh: 28.5,
    charge_needed_kwh: 0,
    verdict: 'comfortable',
    explanation: "You'll arrive with plenty to spare.",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfidence.mockReturnValue({ mutate: vi.fn(), data: null, isPending: false, isError: false, error: null });
});

describe('TripCopilotCard', () => {
  it('shows a loading body only while the initial check is actively running', () => {
    mockConfidence.mockReturnValue({
      mutate: vi.fn(), data: undefined, isPending: true, isPaused: false, isError: false, error: null,
    });
    render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByRole('status').textContent).toContain('Trip Copilot: Loading');
    expect(screen.queryByText(/Enter remaining distance to estimate/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Will I make it?' })).toBeDisabled();
  });

  it('shows a paused initial source without a loading or empty body', () => {
    mockConfidence.mockReturnValue({
      mutate: vi.fn(), data: undefined, isPending: true, isPaused: true, isError: false, error: null,
    });
    render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByText('Refresh paused')).toBeTruthy();
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeTruthy();
    expect(screen.queryByText('Trip Copilot: Loading')).toBeNull();
    expect(screen.queryByText(/Enter remaining distance to estimate/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Will I make it?' })).toBeDisabled();
  });

  it('renders a successful response with zero readings and an empty explanation', () => {
    mockConfidence.mockReturnValue({
      mutate: vi.fn(), data: verdict({ arrival_soc: 0, margin_kwh: 0, explanation: '' }),
      isPending: false, isPaused: false, isError: false, error: null,
    });
    render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByText('Arrival ~0% · 0 kWh margin')).toBeTruthy();
    expect(screen.getByText('You will make it')).toBeTruthy();
    expect(screen.queryByText(/Enter remaining distance to estimate/)).toBeNull();
  });

  it('retries an initial failure using its submitted scenario, not edited inputs', () => {
    const mutate = vi.fn();
    const state = {
      mutate, data: undefined, isPending: false, isPaused: false, isError: false, error: null as Error | null,
    };
    mockConfidence.mockReturnValue(state);
    const { rerender } = render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Will I make it?'));
    Object.assign(state, { isError: true, error: new Error('Confidence service unavailable') });
    rerender(<TripCopilotCard currentSoc={70} minArrivalSoc={20} />);
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '200' } });

    expect(screen.getByText('Confidence service unavailable')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.queryByText(/Enter remaining distance to estimate/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Trip Copilot' }));
    expect(mutate.mock.calls[1][0]).toEqual({ current_soc: 80, remaining_km: 150, min_arrival_soc: 10 });
  });

  it('retains the last successful scenario through loading, pause, failure, source retry and recovery', () => {
    const mutate = vi.fn();
    const state = {
      mutate, data: undefined, isPending: false, isPaused: false, isError: false, error: null as Error | null,
    };
    mockConfidence.mockReturnValue(state);
    const { rerender } = render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Will I make it?'));
    act(() => mutate.mock.calls[0][1].onSuccess(verdict()));
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '200' } });
    fireEvent.click(screen.getByText('Will I make it?'));

    state.isPending = true;
    rerender(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByText('Trip Copilot: Refreshing')).toBeTruthy();
    expect(screen.getByText('Arrival ~48% · 28.5 kWh margin')).toBeTruthy();
    state.isPaused = true;
    rerender(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByText('Refresh paused')).toBeTruthy();
    expect(screen.queryByText('Trip Copilot: Refreshing')).toBeNull();
    expect(screen.getByText('Arrival ~48% · 28.5 kWh margin')).toBeTruthy();

    Object.assign(state, { isPending: false, isPaused: false, isError: true, error: new Error('Refresh unavailable') });
    rerender(<TripCopilotCard currentSoc={70} minArrivalSoc={20} />);
    expect(screen.getByText('Cached · refresh failed')).toBeTruthy();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeTruthy();
    expect(screen.getByText('Checked scenario: starting SOC 80%, minimum arrival SOC 10%, remaining distance 150 km.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Trip Copilot' }));
    expect(mutate.mock.calls[2][0]).toEqual({ current_soc: 80, remaining_km: 200, min_arrival_soc: 10 });

    Object.assign(state, { isError: false, error: null });
    act(() => mutate.mock.calls[2][1].onSuccess(verdict({ arrival_soc: 30 })));
    expect(screen.getByText('Checked scenario: starting SOC 80%, minimum arrival SOC 10%, remaining distance 200 km.')).toBeTruthy();
    expect(screen.getByText('Arrival ~30% · 28.5 kWh margin')).toBeTruthy();
    expect(screen.queryByText('Cached · refresh failed')).toBeNull();
    expect(screen.queryByText('Refresh unavailable')).toBeNull();
  });

  it('labels manual inputs, default assumptions, and unknown observations before a check', () => {
    render(<TripCopilotCard currentSoc={80} minArrivalSoc={20} />);
    expect(screen.getByText('Manual scenario: starting SOC 80% and minimum arrival SOC 20% come from the planner form, not live telemetry.')).toBeTruthy();
    expect(screen.getByText('Server default assumptions: 75 kWh battery capacity, 160 Wh/km consumption, and 1.0 efficiency factor.')).toBeTruthy();
    expect(screen.getByText(/Vehicle observations are unknown for this check: live SOC/)).toBeTruthy();
    expect(screen.getByText('Enter remaining distance to estimate arrival for this manual scenario.')).toBeTruthy();
    expect(screen.queryByText('Enter remaining distance for a live arrival verdict.')).toBeNull();
  });

  it('sends SOC + remaining distance from live form state', () => {
    const mutate = vi.fn();
    mockConfidence.mockReturnValue({ mutate, data: null, isPending: false, isError: false, error: null });
    render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Will I make it?'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ current_soc: 80, remaining_km: 150, min_arrival_soc: 10 });
  });

  it('renders the comfortable verdict with the arrival detail', () => {
    mockConfidence.mockReturnValue({ mutate: vi.fn(), data: verdict(), isPending: false, isError: false, error: null });
    render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByText('You will make it')).toBeTruthy();
    expect(screen.getByText("You'll arrive with plenty to spare.")).toBeTruthy();
    expect(screen.getByText('Arrival ~48% · 28.5 kWh margin')).toBeTruthy();
    expect(screen.getByText(/Server default assumptions:/)).toBeTruthy();
    expect(screen.getByText(/Vehicle observations are unknown for this check:/)).toBeTruthy();
  });

  it('renders the tight verdict without treating the estimate as observed telemetry', () => {
    mockConfidence.mockReturnValue({
      mutate: vi.fn(),
      data: verdict({ verdict: 'tight', arrival_soc: 14, margin_kwh: 3 }),
      isPending: false,
      isError: false,
      error: null,
    });
    render(<TripCopilotCard currentSoc={40} minArrivalSoc={10} />);
    expect(screen.getByText('Tight — drive gently')).toBeTruthy();
    expect(screen.getByText('Arrival ~14% · 3 kWh margin')).toBeTruthy();
    expect(screen.getByText(/Manual scenario: starting SOC 40%/)).toBeTruthy();
  });

  it('renders the charge-first verdict when short', () => {
    mockConfidence.mockReturnValue({
      mutate: vi.fn(),
      data: verdict({ verdict: 'charge_now', arrival_soc: -4, explanation: "You won't make it." }),
      isPending: false,
      isError: false,
      error: null,
    });
    render(<TripCopilotCard currentSoc={20} minArrivalSoc={10} />);
    expect(screen.getByText('Charge first')).toBeTruthy();
  });

  it.each(['distance', 'starting SOC', 'arrival floor'])('retains the captured response when %s changes', (input) => {
    const response = verdict();
    const mutate = vi.fn((_params: TripConfidenceRequest, options: { onSuccess: (response: TripConfidence) => void }) => options.onSuccess(response));
    mockConfidence.mockReturnValue({ mutate, data: null, isPending: false, isError: false, error: null });
    const { rerender } = render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Will I make it?'));

    if (input === 'distance') {
      fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '200' } });
    } else {
      rerender(<TripCopilotCard currentSoc={input === 'starting SOC' ? 70 : 80} minArrivalSoc={input === 'arrival floor' ? 20 : 10} />);
    }

    expect(screen.getByText('Checked scenario: starting SOC 80%, minimum arrival SOC 10%, remaining distance 150 km.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Inputs have changed.');
    expect(screen.getByText("You'll arrive with plenty to spare.")).toBeTruthy();
    expect(screen.getByText('Arrival ~48% · 28.5 kWh margin')).toBeTruthy();
    expect(screen.getByText('You will make it')).toBeTruthy();
  });

  it('keeps prior evidence during a retry and failure, replacing it only on success', () => {
    const response = verdict();
    const mutate = vi.fn((_params: TripConfidenceRequest, options: { onSuccess: (response: TripConfidence) => void }) => options.onSuccess(response));
    const state = { mutate, data: null, isPending: false, isError: false, error: null as Error | null };
    mockConfidence.mockReturnValue(state);
    const { rerender } = render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Will I make it?'));
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '200' } });

    state.isPending = true;
    rerender(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByText("You'll arrive with plenty to spare.")).toBeTruthy();
    state.isPending = false;
    state.isError = true;
    state.error = new Error('Request failed');
    rerender(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByText('Request failed')).toBeTruthy();
    expect(screen.getByText('Checked scenario: starting SOC 80%, minimum arrival SOC 10%, remaining distance 150 km.')).toBeTruthy();

    state.isError = false;
    mutate.mockImplementation((_params, options) => options.onSuccess(verdict({ arrival_soc: 30 })));
    fireEvent.click(screen.getByText('Will I make it?'));
    expect(screen.getByText('Checked scenario: starting SOC 80%, minimum arrival SOC 10%, remaining distance 200 km.')).toBeTruthy();
    expect(screen.getByText('Arrival ~30% · 28.5 kWh margin')).toBeTruthy();
    expect(screen.queryByText(/Inputs have changed/)).toBeNull();
  });

  it('captures submission inputs even if they change before the response arrives', () => {
    const mutate = vi.fn();
    mockConfidence.mockReturnValue({ mutate, data: null, isPending: false, isError: false, error: null });
    const { rerender } = render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Will I make it?'));
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '200' } });
    rerender(<TripCopilotCard currentSoc={70} minArrivalSoc={20} />);

    const options = mutate.mock.calls[0][1] as { onSuccess: (response: TripConfidence) => void };
    act(() => options.onSuccess(verdict()));
    expect(screen.getByText('Checked scenario: starting SOC 80%, minimum arrival SOC 10%, remaining distance 150 km.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Inputs have changed.');

    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '150' } });
    rerender(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.queryByText(/Inputs have changed/)).toBeNull();
    expect(screen.getByText('Arrival ~48% · 28.5 kWh margin')).toBeTruthy();
  });
});
