/**
 * AutopilotPanel — behaviour coverage.
 *
 * Data hooks (`useAutopilotProfile` / `useSaveAutopilotProfile` /
 * `useAutopilotPreview` / `useAutopilotRun` / `useAutopilotSavings` /
 * `useRatePlans`) are mocked and driven per test; shared UI (GlassPanel,
 * MetricCard, Toggle/Slider/Select/Input, RateTimeline) is REAL so the
 * render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { AutopilotProfile, AutopilotPreview, AutopilotSavings } from '@/types/charging';

// ── i18n stub ──
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

// ── framer-motion: inert ──
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

// ── formatters ──
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (v: unknown) => (v == null ? '—' : new Date(v as string).toISOString().slice(11, 16)),
    formatDateTime: (v: unknown) => (v == null ? '—' : new Date(v as string).toISOString().slice(0, 10)),
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) => `$${Number(amount ?? 0).toFixed(decimals)}`,
  }),
}));

// ── data hooks, driven per test ──
vi.mock('@/api/hooks/useCharging', () => ({
  useAutopilotProfile: vi.fn(),
  useSaveAutopilotProfile: vi.fn(),
  useAutopilotPreview: vi.fn(),
  useAutopilotRun: vi.fn(),
  useAutopilotSavings: vi.fn(),
  useRatePlans: vi.fn(),
}));

import {
  useAutopilotProfile,
  useSaveAutopilotProfile,
  useAutopilotPreview,
  useAutopilotRun,
  useAutopilotSavings,
  useRatePlans,
} from '@/api/hooks/useCharging';
import { AutopilotPanel } from './AutopilotPanel';

const mockProfile = useAutopilotProfile as unknown as ReturnType<typeof vi.fn>;
const mockSave = useSaveAutopilotProfile as unknown as ReturnType<typeof vi.fn>;
const mockPreview = useAutopilotPreview as unknown as ReturnType<typeof vi.fn>;
const mockRun = useAutopilotRun as unknown as ReturnType<typeof vi.fn>;
const mockSavings = useAutopilotSavings as unknown as ReturnType<typeof vi.fn>;
const mockRatePlans = useRatePlans as unknown as ReturnType<typeof vi.fn>;

const storedProfile: AutopilotProfile = {
  vehicle_id: 7,
  enabled: true,
  target_soc: 90,
  ready_by: '06:45',
  rate_plan: 'pge-ev2a',
  daily_cap_soc: 80,
  trip_override: false,
  precondition: true,
  max_amps: 32,
  battery_capacity_kwh: 75,
};

const previewResult: AutopilotPreview = {
  effective_target_soc: 80,
  capped_by_health_guardrail: true,
  ready_by: '2026-01-16T07:30:00.000Z',
  kwh_needed: 22.5,
  estimated_duration_hours: 3.1,
  window: {
    start_time: '2026-01-16T00:00:00.000Z',
    end_time: '2026-01-16T03:06:00.000Z',
    rate_cents_kwh: 35,
    estimated_cost: 7.88,
    rate_tier: 'OFF_PEAK',
  },
  charge_now_cost: 11.03,
  optimized_cost: 7.88,
  savings: 3.15,
  savings_percent: 28.6,
  hourly_rates: [],
  explanation: 'Charge 50% → 80% in the OFF_PEAK window.',
};

function queryOk(data: unknown) {
  return { data, isLoading: false, isError: false, error: null, refetch: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProfile.mockReturnValue(queryOk(storedProfile));
  mockRatePlans.mockReturnValue(queryOk([]));
  mockSavings.mockReturnValue(
    queryOk({ total_savings: 12.5, runs: 4 } satisfies AutopilotSavings),
  );
  mockSave.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
  mockPreview.mockReturnValue({ mutate: vi.fn(), data: null, isPending: false, isError: false, error: null });
  mockRun.mockReturnValue({ mutate: vi.fn(), data: null, isPending: false, isError: false, error: null });
});

describe('AutopilotPanel', () => {
  it('seeds the form from the stored profile and shows the on badge', () => {
    render(<AutopilotPanel vehicleId={7} />);
    expect(screen.getByText('Charging Autopilot')).toBeTruthy();
    expect(screen.getByText('Autopilot on')).toBeTruthy();
    expect(screen.getByDisplayValue('06:45')).toBeTruthy();
  });

  it('disables actions and prompts when no vehicle is selected', () => {
    render(<AutopilotPanel vehicleId={undefined} />);
    expect(screen.getByText('Select a vehicle to configure autopilot.')).toBeTruthy();
    expect(screen.getByText('Save Autopilot').closest('button')).toHaveProperty('disabled', true);
    expect(screen.getByText('Preview next run').closest('button')).toHaveProperty('disabled', true);
    expect(screen.getByText('Run now').closest('button')).toHaveProperty('disabled', true);
  });

  it('disables Run now while autopilot is off', () => {
    mockProfile.mockReturnValue(queryOk({ ...storedProfile, enabled: false }));
    render(<AutopilotPanel vehicleId={7} />);
    expect(screen.getByText('Autopilot off')).toBeTruthy();
    expect(screen.getByText('Run now').closest('button')).toHaveProperty('disabled', true);
  });

  it('saves the snake_case profile assembled from live form state', () => {
    const mutate = vi.fn();
    mockSave.mockReturnValue({ mutate, isPending: false, isError: false, error: null });
    render(<AutopilotPanel vehicleId={7} />);
    fireEvent.click(screen.getByText('Save Autopilot'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      vehicle_id: 7,
      target_soc: 90,
      ready_by: '06:45',
      rate_plan: 'pge-ev2a',
      daily_cap_soc: 80,
    });
  });

  it('renders the preview explanation, health-cap badge, and savings', () => {
    mockPreview.mockReturnValue({
      mutate: vi.fn(),
      data: previewResult,
      isPending: false,
      isError: false,
      error: null,
    });
    render(<AutopilotPanel vehicleId={7} />);
    expect(screen.getByText('Charge 50% → 80% in the OFF_PEAK window.')).toBeTruthy();
    expect(screen.getByText(/Health cap/)).toBeTruthy();
    expect(screen.getByText('$12.50 across 4 runs')).toBeTruthy();
  });

  it('surfaces preview errors', () => {
    mockPreview.mockReturnValue({
      mutate: vi.fn(),
      data: null,
      isPending: false,
      isError: true,
      error: new Error('not enough time'),
    });
    render(<AutopilotPanel vehicleId={7} />);
    expect(screen.getByText('not enough time')).toBeTruthy();
  });

  it('runs the autopilot schedule on the vehicle with one click', () => {
    const mutate = vi.fn();
    mockRun.mockReturnValue({ mutate, data: null, isPending: false, isError: false, error: null });
    render(<AutopilotPanel vehicleId={7} />);
    fireEvent.click(screen.getByText('Run now'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ vehicle_id: 7 });
  });

  it('shows the run confirmation and surfaces run errors', () => {
    mockRun.mockReturnValue({
      mutate: vi.fn(),
      data: {
        status: 'scheduled',
        plan_id: 42,
        start_time: '01:00',
        target_soc: 80,
        savings: 3.15,
        message: 'Autopilot scheduled charging at 01:00',
      },
      isPending: false,
      isError: false,
      error: null,
    });
    const { rerender } = render(<AutopilotPanel vehicleId={7} />);
    expect(screen.getByText('Autopilot scheduled charging at 01:00')).toBeTruthy();

    mockRun.mockReturnValue({
      mutate: vi.fn(),
      data: null,
      isPending: false,
      isError: true,
      error: new Error('failed to apply charge schedule to vehicle'),
    });
    rerender(<AutopilotPanel vehicleId={7} />);
    expect(screen.getByText('failed to apply charge schedule to vehicle')).toBeTruthy();
  });
});
