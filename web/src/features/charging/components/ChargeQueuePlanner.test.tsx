/**
 * ChargeQueuePlanner — posts per-vehicle rows; renders ordered slots.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { QueueAdvice } from '@/types/charging';

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

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (v: unknown) => (v == null ? '—' : new Date(v as string).toISOString().slice(11, 16)),
  }),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));
vi.mock('@/api/hooks/useCharging', () => ({ useAdviseChargeQueue: vi.fn() }));

import { useVehicles } from '@/api/hooks/useVehicles';
import { useAdviseChargeQueue } from '@/api/hooks/useCharging';
import { ChargeQueuePlanner } from './ChargeQueuePlanner';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockAdvise = useAdviseChargeQueue as unknown as ReturnType<typeof vi.fn>;

const cars = [
  { id: 1, display_name: 'Alpha' },
  { id: 2, display_name: 'Beta' },
];

const advice: QueueAdvice = {
  all_feasible: true,
  explanation: 'Charge in order.',
  slots: [
    { vehicle_id: 2, position: 1, start_time: '2026-03-10T18:00:00.000Z', end_time: '2026-03-10T21:00:00.000Z', kwh_needed: 33, ready_by: '2026-03-11T06:00:00.000Z', slack_hours: 9, feasible: true },
    { vehicle_id: 1, position: 2, start_time: '2026-03-10T21:00:00.000Z', end_time: '2026-03-11T00:00:00.000Z', kwh_needed: 22.5, ready_by: '2026-03-11T07:30:00.000Z', slack_hours: 7.5, feasible: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockVehicles.mockReturnValue({ data: cars });
  mockAdvise.mockReturnValue({ mutate: vi.fn(), data: null, isPending: false, isError: false, error: null });
});

describe('ChargeQueuePlanner', () => {
  it('prompts for a second vehicle with only one car', () => {
    mockVehicles.mockReturnValue({ data: cars.slice(0, 1) });
    render(<ChargeQueuePlanner />);
    expect(screen.getByText('Add a second vehicle to plan a shared-charger queue.')).toBeTruthy();
  });

  it('posts default rows for every car', () => {
    const mutate = vi.fn();
    mockAdvise.mockReturnValue({ mutate, data: null, isPending: false, isError: false, error: null });
    render(<ChargeQueuePlanner />);
    fireEvent.click(screen.getByText('Plan queue'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      charger_kw: 11,
      vehicles: [
        { vehicle_id: 1, current_soc: 40, target_soc: 80, ready_by: '07:30' },
        { vehicle_id: 2, current_soc: 40, target_soc: 80, ready_by: '07:30' },
      ],
    });
  });

  it('renders the ordered queue with per-car windows', () => {
    mockAdvise.mockReturnValue({ mutate: vi.fn(), data: advice, isPending: false, isError: false, error: null });
    render(<ChargeQueuePlanner />);
    expect(screen.getByText('All cars ready on time')).toBeTruthy();
    expect(screen.getByText('Charge in order.')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });
});
