/**
 * StormGuardPanel — behaviour coverage.
 *
 * Data hooks (`useStormguardStatus` / `useStormguardEvents` /
 * `useSaveStormguardConfig`) are mocked and driven per test; shared UI
 * (GlassPanel, Badge, Toggle, Input, Slider, Button) is REAL so the
 * render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import type { StormguardConfig, StormguardConfigRequest } from '@/api/hooks/useStormguard';

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
  mockStatus.mockReturnValue({ data: armedStatus, isLoading: false, isError: false });
  mockEvents.mockReturnValue({ data: [], isLoading: false, isError: false });
  mockSave.mockReturnValue({ mutate: vi.fn(), reset, isPending: false, isError: false, error: null });
});

describe('StormGuardPanel', () => {
  it('renders the live assessment with warning badge and battery state', () => {
    render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('Storm guardian')).toBeInTheDocument();
    expect(screen.getByText('Storm warning')).toBeInTheDocument();
    expect(screen.getByText(/thunderstorm \(WMO 95\)/)).toBeInTheDocument();
    expect(screen.getByText(/Battery 60%/)).toBeInTheDocument();
    expect(screen.getByText(/Peak gust 28\.00 m\/s/)).toBeInTheDocument();
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
