/**
 * TripCopilotCard — verdict badges + payload wiring. `useTripConfidence`
 * is mocked; GlassPanel/Badge render for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { TripConfidence } from '@/types/driving';

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
  it('sends SOC + remaining distance from live form state', () => {
    const mutate = vi.fn();
    mockConfidence.mockReturnValue({ mutate, data: null, isPending: false, isError: false, error: null });
    render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    fireEvent.change(screen.getByLabelText('Remaining (km)'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Will I make it?'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ current_soc: 80, remaining_km: 150, min_arrival_soc: 10 });
  });

  it('renders the comfortable verdict with the arrival detail', () => {
    mockConfidence.mockReturnValue({ mutate: vi.fn(), data: verdict(), isPending: false, isError: false, error: null });
    render(<TripCopilotCard currentSoc={80} minArrivalSoc={10} />);
    expect(screen.getByText('You will make it')).toBeTruthy();
    expect(screen.getByText("You'll arrive with plenty to spare.")).toBeTruthy();
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
});
