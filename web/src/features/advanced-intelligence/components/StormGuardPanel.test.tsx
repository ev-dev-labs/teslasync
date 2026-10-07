/**
 * StormGuardPanel — behaviour coverage.
 *
 * Data hooks (`useStormguardStatus` / `useStormguardEvents` /
 * `useSaveStormguardConfig`) are mocked and driven per test; shared UI
 * (GlassPanel, Badge, Toggle, Input, Slider, Button) is REAL so the
 * render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
  mockSave.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
});

describe('StormGuardPanel', () => {
  it('renders the live assessment with warning badge and battery state', () => {
    render(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('Storm Guardian')).toBeInTheDocument();
    expect(screen.getByText('Storm warning')).toBeInTheDocument();
    expect(screen.getByText(/thunderstorm \(WMO 95\)/)).toBeInTheDocument();
    expect(screen.getByText(/Battery 60%/)).toBeInTheDocument();
    expect(screen.getByText(/Peak gust 28 m\/s/)).toBeInTheDocument();
  });

  it('hydrates the form from stored config and saves edits', () => {
    const mutate = vi.fn();
    mockSave.mockReturnValue({ mutate, isPending: false, isError: false, error: null });
    render(<StormGuardPanel vehicleId={7} />);

    expect(screen.getByLabelText('Home latitude')).toHaveProperty('value', '37.7');
    fireEvent.change(screen.getByLabelText('Home latitude'), { target: { value: '38.1' } });
    fireEvent.click(screen.getByText('Save Guard'));

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
      isPending: false,
      isError: true,
      error: new Error('db down'),
    });
    rerender(<StormGuardPanel vehicleId={7} />);
    expect(screen.getByText('db down')).toBeInTheDocument();
  });
});
