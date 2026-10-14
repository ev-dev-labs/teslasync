/**
 * StormGuardPanel — behaviour coverage.
 *
 * Data hooks (`useStormguardStatus` / `useStormguardEvents` /
 * `useSaveStormguardConfig`) are mocked and driven per test; shared UI
 * (GlassPanel, Badge, Toggle, Input, Slider, Button) is REAL so the
 * render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import type { StormguardConfig, StormguardConfigRequest } from '@/api/hooks/useStormguard';

const displaySettings = vi.hoisted(() => ({
  unit_of_length: 'km',
  decimal_precision: 2,
  locale: 'en-US',
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: displaySettings }),
}));

vi.mock('@/api/hooks/useStormguard', () => ({
  useStormguardStatus: vi.fn(),
  useStormguardEvents: vi.fn(),
  useSaveStormguardConfig: vi.fn(),
}));

import {
  useStormguardStatus,
  useStormguardEvents,
  useSaveStormguardConfig,
} from '@/api/hooks/useStormguard';
import { StormGuardPanel } from './StormGuardPanel';

const mockStatus = useStormguardStatus as unknown as ReturnType<typeof vi.fn>;
const mockEvents = useStormguardEvents as unknown as ReturnType<typeof vi.fn>;
const mockSave = useSaveStormguardConfig as unknown as ReturnType<typeof vi.fn>;
const reset = vi.fn();

const armedStatus = {
  config: { vehicle_id: 7, enabled: true, lat: 37.7, lng: -122.4, target_soc: 95, updated_at: '' },
  assessment: {
    level: 'warning',
    reason: 'thunderstorm (WMO 95) forecast at Mon 18:00',
    starts_at: '2026-04-01T18:00:00Z',
    peak_gust_ms: 28,
  },
  current_soc: 60,
};

beforeEach(() => {
  vi.clearAllMocks();
  displaySettings.unit_of_length = 'km';
  displaySettings.decimal_precision = 2;
  displaySettings.locale = 'en-US';
  mockStatus.mockReturnValue({ data: armedStatus, isLoading: false, isError: false });
  mockEvents.mockReturnValue({ data: [], isLoading: false, isError: false });
  mockSave.mockReturnValue({ mutate: vi.fn(), reset, isPending: false, isError: false, error: null });
});

describe('StormGuardPanel', () => {
  it.each([
    { preference: 'km', gust: 28, caption: 'Peak gust 100.80 km/h' },
    { preference: 'mi', gust: 28, caption: 'Peak gust 62.63 mph' },
    { preference: 'km', gust: 0, caption: 'Peak gust 0.00 km/h' },
    { preference: 'mi', gust: 0, caption: 'Peak gust 0.00 mph' },
    { preference: 'km', gust: null, caption: 'Peak gust —' },
    { preference: 'mi', gust: undefined, caption: 'Peak gust —' },
    { preference: 'km', gust: Number.NaN, caption: 'Peak gust —' },
    { preference: 'mi', gust: Number.POSITIVE_INFINITY, caption: 'Peak gust —' },
  ])('formats the raw m/s gust $gust for $preference without inventing readings', ({ preference, gust, caption }) => {
    displaySettings.unit_of_length = preference;
    const status = {
      ...armedStatus,
      assessment: { ...armedStatus.assessment, peak_gust_ms: gust },
    };
    mockStatus.mockReturnValue({ data: status, isLoading: false, isError: false });
    render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText(caption)).toBeInTheDocument();
    expect(status.assessment.peak_gust_ms).toBe(gust);
    expect(screen.getByText('Battery 60%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save guard' })).toBeEnabled();
  });

  it('updates the caption when the selected display preference changes', () => {
    const { rerender } = render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('Peak gust 100.80 km/h')).toBeInTheDocument();
    displaySettings.unit_of_length = 'mi';
    displaySettings.decimal_precision = 1;
    rerender(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('Peak gust 62.6 mph')).toBeInTheDocument();
    expect(screen.queryByText('Peak gust 100.80 km/h')).not.toBeInTheDocument();
    expect(armedStatus.assessment.peak_gust_ms).toBe(28);
  });

  it.each([
    { level: 'none', label: 'Clear', token: '--semantic-success', icon: 'shield-check' },
    { level: 'watch', label: 'Storm watch', token: '--semantic-warning', icon: 'triangle-alert' },
    { level: 'warning', label: 'Storm warning', token: '--semantic-danger', icon: 'triangle-alert' },
    { level: 'unknown', label: 'Unknown', token: '--text-secondary', icon: 'info' },
    { level: 'unsupported', label: 'Unknown', token: '--text-secondary', icon: 'info' },
    { level: 'future-level', label: 'Unknown', token: '--text-secondary', icon: 'info' },
    { level: '', label: 'Unknown', token: '--text-secondary', icon: 'info' },
    { level: null, label: 'Unknown', token: '--text-secondary', icon: 'info' },
    { level: undefined, label: 'Unknown', token: '--text-secondary', icon: 'info' },
  ])('presents level $level consistently in the assessment and recent activity', ({ level, label, token, icon }) => {
    mockStatus.mockReturnValue({
      data: { ...armedStatus, assessment: { ...armedStatus.assessment, level } },
      isLoading: false, isError: false,
    });
    mockEvents.mockReturnValue({
      data: [{ id: 1, vehicle_id: 7, level, reason: 'Recorded weather assessment', acted: true, created_at: '2026-04-01T12:00:00Z' }],
      isLoading: false, isError: false,
    });
    const { container } = render(<StormGuardPanel vehicleId={7} />);
    const badges = screen.getAllByText(label);
    expect(badges).toHaveLength(2);
    for (const badge of badges) {
      expect(badge).toHaveClass(`text-[var(${token})]`);
      if (label === 'Unknown') {
        expect(badge.className).not.toMatch(/semantic-(success|warning|danger)/);
      }
    }
    expect(badges[0].querySelector(`svg.lucide-${icon}`)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Recent activity' })).getByText(label)).toBe(badges[1]);
    expect(screen.getByText('Recorded weather assessment')).toBeInTheDocument();
    expect(screen.getByText(/acted/)).toBeInTheDocument();
    expect(screen.getByText('Battery 60%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save guard' })).toBeEnabled();
    if (label === 'Unknown') {
      expect(screen.queryByText('Clear')).not.toBeInTheDocument();
      expect(container.querySelector('svg.lucide-triangle-alert')).not.toBeInTheDocument();
      expect(container.querySelector('svg.lucide-shield-check')).not.toBeInTheDocument();
    }
  });

  it.each([
    { isLoading: true, isFetching: true, fetchStatus: 'fetching' },
    { isLoading: false, isFetching: true, fetchStatus: 'fetching' },
  ])('keeps recent activity visible during active initial loading: %j', (loading) => {
    mockStatus.mockReturnValue({ data: undefined, isPending: true, isError: false, ...loading });
    mockEvents.mockReturnValue({
      data: [{ id: 1, vehicle_id: 7, level: 'warning', reason: 'Independent recent storm', acted: true, created_at: '2026-04-01T12:00:00Z' }],
      isLoading: false, isError: false,
    });
    const { container } = render(<StormGuardPanel vehicleId={7} />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.getByText('Independent recent storm')).toBeInTheDocument();
    expect(screen.queryByText('Weather assessment unavailable.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Home latitude')).not.toBeInTheDocument();
    expect(screen.queryByText(/Battery/)).not.toBeInTheDocument();
  });

  it('shows a retryable pause without inventing an assessment failure or erasing activity', () => {
    const refetch = vi.fn();
    mockStatus.mockReturnValue({
      data: undefined, isLoading: false, isPending: true, isError: false,
      fetchStatus: 'paused', refetch,
    });
    mockEvents.mockReturnValue({
      data: [{ id: 1, vehicle_id: 7, level: 'warning', reason: 'Independent recent storm', acted: true, created_at: '2026-04-01T12:00:00Z' }],
      isLoading: false, isError: false,
    });
    const { container } = render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    expect(screen.getByText('Independent recent storm')).toBeInTheDocument();
    expect(screen.queryByText('Weather assessment unavailable.')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Home latitude')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Storm guardian' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('does not infer failure, empty weather, or zero from an idle unresolved status', () => {
    mockStatus.mockReturnValue({
      data: undefined, isPending: true, isLoading: false, isError: false, fetchStatus: 'idle',
    });
    render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    expect(screen.queryByText('Weather assessment unavailable.')).not.toBeInTheDocument();
    expect(screen.queryByText('Clear')).not.toBeInTheDocument();
    expect(screen.queryByText(/Peak gust|Battery/)).not.toBeInTheDocument();
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
  });

  it('renders confirmed zero readings and successful empty recent activity', () => {
    mockStatus.mockReturnValue({
      data: {
        ...armedStatus,
        assessment: { ...armedStatus.assessment, level: 'none', reason: 'No severe weather forecast', peak_gust_ms: 0 },
        current_soc: 0,
      },
      isSuccess: true, isLoading: false, isError: false, fetchStatus: 'idle',
    });
    render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('No severe weather forecast')).toBeInTheDocument();
    expect(screen.getByText('Peak gust 0.00 km/h')).toBeInTheDocument();
    expect(screen.getByText('Battery 0%')).toBeInTheDocument();
    expect(screen.getByText('No recent storm activity was returned.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save guard' })).toBeEnabled();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('retains assessment, edits, and activity through refresh failure and recovery', () => {
    const refetch = vi.fn();
    mockEvents.mockReturnValue({
      data: [{ id: 1, vehicle_id: 7, level: 'warning', reason: 'Independent recent storm', acted: true, created_at: '2026-04-01T12:00:00Z' }],
      isLoading: false, isError: false,
    });
    const { rerender } = render(<StormGuardPanel vehicleId={7} />);
    fireEvent.change(screen.getByLabelText('Home latitude'), { target: { value: '38.1' } });
    mockStatus.mockReturnValue({
      data: armedStatus, isLoading: false, isError: true, error: new Error('refresh failed'), refetch,
    });
    rerender(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText(/thunderstorm \(WMO 95\)/)).toBeInTheDocument();
    expect(screen.getByText('Battery 60%')).toBeInTheDocument();
    expect(screen.getByLabelText('Home latitude')).toHaveValue('38.1');
    expect(screen.getByText('Independent recent storm')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    mockStatus.mockReturnValue({ data: armedStatus, isLoading: false, isError: false, isFetching: true, refetch });
    rerender(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByLabelText('Home latitude')).toHaveValue('38.1');
    expect(screen.getByText('Battery 60%')).toBeInTheDocument();
    expect(screen.getByText('Independent recent storm')).toBeInTheDocument();

    mockStatus.mockReturnValue({
      data: { ...armedStatus, current_soc: 65 }, isSuccess: true,
      isLoading: false, isError: false, isFetching: false, fetchStatus: 'idle', refetch,
    });
    rerender(<StormGuardPanel vehicleId={7} />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('Battery 65%')).toBeInTheDocument();
    expect(screen.getByLabelText('Home latitude')).toHaveValue('38.1');
    expect(screen.getByText('Independent recent storm')).toBeInTheDocument();
  });

  it('renders the live assessment with warning badge and battery state', () => {
    render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('Storm guardian')).toBeInTheDocument();
    expect(screen.getByText('Storm warning')).toBeInTheDocument();
    expect(screen.getByText(/thunderstorm \(WMO 95\)/)).toBeInTheDocument();
    expect(screen.getByText(/Battery 60%/)).toBeInTheDocument();
    expect(screen.getByText('Peak gust 100.80 km/h')).toBeInTheDocument();
  });

  it('hydrates the form from stored config and saves edits', () => {
    const mutate = vi.fn();
    mockSave.mockReturnValue({ mutate, reset, isPending: false, isError: false, error: null });
    render(<StormGuardPanel vehicleId={7} />);

    expect(screen.getByLabelText('Home latitude')).toHaveProperty('value', '37.7');
    fireEvent.change(screen.getByLabelText('Home latitude'), { target: { value: '38.1' } });
    fireEvent.click(screen.getByText('Save guard'));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      vehicle_id: 7,
      enabled: true,
      lat: 38.1,
      lng: -122.4,
      target_soc: 95,
    });
  });

  it('renders the recent activity timeline with acted markers', () => {
    mockEvents.mockReturnValue({
      data: [
        { id: 1, vehicle_id: 7, level: 'warning', reason: 'thunderstorm', acted: true, created_at: '2026-04-01T12:00:00Z' },
      ],
      isLoading: false,
      isError: false,
    });
    render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    expect(screen.getByText(/acted/)).toBeInTheDocument();
  });

  it('prompts for a vehicle and surfaces save errors', () => {
    const { rerender } = render(<StormGuardPanel vehicleId={undefined} />);
    expect(screen.getByText('Select a vehicle to configure storm protection.')).toBeInTheDocument();

    mockSave.mockReturnValue({
      mutate: vi.fn(),
      reset,
      variables: { vehicle_id: 7 },
      isPending: false,
      isError: true,
      error: new Error('db down'),
    });
    rerender(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('db down')).toBeInTheDocument();
  });

  it('keeps independent drafts and rejects delayed hydration from another vehicle', () => {
    const { rerender } = render(<StormGuardPanel vehicleId={7} />);
    fireEvent.change(screen.getByLabelText('Home latitude'), { target: { value: '38.1' } });
    rerender(<StormGuardPanel vehicleId={8} />);
    expect(screen.queryByLabelText('Home latitude')).not.toBeInTheDocument();
    expect(screen.queryByText(/thunderstorm \(WMO 95\)/)).not.toBeInTheDocument();

    mockStatus.mockReturnValue({
      data: { ...armedStatus, config: { ...armedStatus.config, vehicle_id: 8, lat: 40 } },
      isLoading: false, isError: false,
    });
    rerender(<StormGuardPanel vehicleId={8} />);
    expect(screen.getByLabelText('Home latitude')).toHaveValue('40');
    fireEvent.change(screen.getByLabelText('Home latitude'), { target: { value: '41' } });

    mockStatus.mockReturnValue({ data: armedStatus, isLoading: false, isError: false });
    rerender(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByLabelText('Home latitude')).toHaveValue('38.1');
    mockStatus.mockReturnValue({
      data: { ...armedStatus, config: { ...armedStatus.config, vehicle_id: 8, lat: 42 } },
      isLoading: false, isError: false,
    });
    rerender(<StormGuardPanel vehicleId={8} />);
    expect(screen.getByLabelText('Home latitude')).toHaveValue('41');
  });

  it.each(['success', 'rejection'] as const)(
    'ignores stale %s after switching away and back during a pending save',
    async (settlement) => {
      let resolve!: (config: StormguardConfig) => void;
      let reject!: (error: Error) => void;
      const save = vi.fn((_params: StormguardConfigRequest) => new Promise<StormguardConfig>((res, rej) => {
        resolve = res;
        reject = rej;
      }));
      mockSave.mockImplementation(() => useMutation({ mutationFn: save }));
      const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
      const panel = (id: number) => (
        <QueryClientProvider client={client}><StormGuardPanel vehicleId={id} /></QueryClientProvider>
      );
      const { rerender } = render(panel(7));
      fireEvent.change(screen.getByLabelText('Home latitude'), { target: { value: '38.1' } });
      fireEvent.click(screen.getByText('Save guard'));
      await waitFor(() => expect(save.mock.calls[0]?.[0]).toMatchObject({ vehicle_id: 7, lat: 38.1 }));
      await waitFor(() => expect(screen.getByRole('button', { name: /Save guard/ })).toBeDisabled());
      mockStatus.mockReturnValue({
        data: { ...armedStatus, config: { ...armedStatus.config, vehicle_id: 8, lat: 40 } },
        isLoading: false, isError: false,
      });
      rerender(panel(8));
      expect(screen.getByRole('button', { name: /Save guard/ })).toBeEnabled();
      expect(screen.getByLabelText('Home latitude')).toHaveValue('40');
      mockStatus.mockReturnValue({ data: armedStatus, isLoading: false, isError: false });
      rerender(panel(7));
      await act(async () => {
        if (settlement === 'success') resolve({ ...armedStatus.config, lat: 38.1 });
        else reject(new Error('old save failed'));
      });
      expect(screen.queryByText('old save failed')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Save guard/ })).toBeEnabled();
      expect(screen.getByLabelText('Home latitude')).toHaveValue('38.1');
    },
  );

  it.each(['success', 'rejection'] as const)('handles matching save %s without losing edits', async (settlement) => {
    let resolve!: (config: StormguardConfig) => void;
    let reject!: (error: Error) => void;
    const save = vi.fn((_params: StormguardConfigRequest) => new Promise<StormguardConfig>((res, rej) => {
      resolve = res;
      reject = rej;
    }));
    mockSave.mockImplementation(() => useMutation({ mutationFn: save }));
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><StormGuardPanel vehicleId={7} /></QueryClientProvider>);
    fireEvent.click(screen.getByText('Save guard'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Home latitude'), { target: { value: '39' } });
    await act(async () => {
      if (settlement === 'success') resolve(armedStatus.config);
      else reject(new Error('matching save failed'));
    });
    await waitFor(() => expect(screen.getByRole('button', { name: /Save guard/ })).toBeEnabled());
    expect(screen.getByLabelText('Home latitude')).toHaveValue('39');
    if (settlement === 'rejection') expect(screen.getByText('matching save failed')).toBeInTheDocument();
    else expect(screen.queryByText('matching save failed')).not.toBeInTheDocument();
  });
});
