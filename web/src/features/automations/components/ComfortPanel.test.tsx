/**
 * ComfortPanel — behaviour coverage.
 *
 * Data hooks (`useComfortNext` / `useComfortRuns` / `useSaveComfortConfig`
 * / `usePreconditionNow`) plus `useSelectedVehicle` are mocked and driven
 * per test; shared UI (GlassPanel, Badge, Toggle, Input, Slider, Button)
 * is REAL so the render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/api/hooks/useComfort', () => ({
  useComfortNext: vi.fn(),
  useComfortRuns: vi.fn(),
  useSaveComfortConfig: vi.fn(),
  usePreconditionNow: vi.fn(),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: vi.fn(),
}));

import {
  useComfortNext,
  useComfortRuns,
  useSaveComfortConfig,
  usePreconditionNow,
} from '@/api/hooks/useComfort';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { ComfortPanel } from './ComfortPanel';

const mockNext = useComfortNext as unknown as ReturnType<typeof vi.fn>;
const mockRuns = useComfortRuns as unknown as ReturnType<typeof vi.fn>;
const mockSave = useSaveComfortConfig as unknown as ReturnType<typeof vi.fn>;
const mockNow = usePreconditionNow as unknown as ReturnType<typeof vi.fn>;
const mockVehicle = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;

const armedNext = {
  config: {
    vehicle_id: 7, enabled: true, target_temp_c: 22, lead_minutes: 30,
    ics_url: 'https://x/y.ics', updated_at: '',
  },
  event: {
    uid: 'a', title: 'Dentist', location: '123 Main',
    starts_at: '2026-04-01T15:00:00Z', all_day: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVehicle.mockReturnValue({ vehicleId: 7 });
  mockNext.mockReturnValue({ data: armedNext, isLoading: false, isError: false });
  mockRuns.mockReturnValue({ data: [], isLoading: false, isError: false });
  mockSave.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
  mockNow.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
});

describe('ComfortPanel', () => {
  it('renders the next offsite event with armed badge', () => {
    render(<ComfortPanel />);
    expect(screen.getByText('Cabin Comfort Autopilot')).toBeInTheDocument();
    expect(screen.getByText('Armed')).toBeInTheDocument();
    expect(screen.getByText(/Dentist/)).toBeInTheDocument();
    expect(screen.getByText(/123 Main/)).toBeInTheDocument();
  });

  it('hydrates the form and saves edits', () => {
    const mutate = vi.fn();
    mockSave.mockReturnValue({ mutate, isPending: false, isError: false, error: null });
    render(<ComfortPanel />);

    expect(screen.getByLabelText('Calendar subscription URL (ICS)')).toHaveProperty(
      'value', 'https://x/y.ics',
    );
    fireEvent.change(screen.getByLabelText('Calendar subscription URL (ICS)'), {
      target: { value: 'https://x/z.ics' },
    });
    fireEvent.click(screen.getByText('Save Autopilot'));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      vehicle_id: 7,
      enabled: true,
      target_temp_c: 22,
      lead_minutes: 30,
      ics_url: 'https://x/z.ics',
    });
  });

  it('preconditions on demand', () => {
    const mutate = vi.fn();
    mockNow.mockReturnValue({ mutate, isPending: false, isError: false, error: null });
    render(<ComfortPanel />);
    fireEvent.click(screen.getByText('Precondition now'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe(7);
  });

  it('prompts for a feed, a vehicle, and surfaces errors', () => {
    mockNext.mockReturnValue({
      data: { config: { ...armedNext.config, ics_url: '' }, event: undefined },
      isLoading: false,
      isError: false,
    });
    const { rerender } = render(<ComfortPanel />);
    expect(screen.getByText('Add a calendar subscription to watch for events.')).toBeInTheDocument();

    mockVehicle.mockReturnValue({ vehicleId: null });
    rerender(<ComfortPanel />);
    expect(screen.getByText('Select a vehicle to configure cabin comfort.')).toBeInTheDocument();

    mockVehicle.mockReturnValue({ vehicleId: 7 });
    mockSave.mockReturnValue({
      mutate: vi.fn(), isPending: false, isError: true, error: new Error('db down'),
    });
    rerender(<ComfortPanel />);
    expect(screen.getByText('db down')).toBeInTheDocument();
  });
});
