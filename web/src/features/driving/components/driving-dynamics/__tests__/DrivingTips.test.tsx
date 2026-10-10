/**
 * Ride guidance must explain measurements, never manufacture a style score,
 * guaranteed savings, braking quality, or an overheating diagnosis.
 * The original global tone regression remains covered: each row owns its icon.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import DrivingTips from '../DrivingTips';
import type { MotorStats } from '../helpers';

let mockMotorStats: MotorStats | null = null;
let loading = false;
let error: Error | null = null;
const retry = vi.fn();

vi.mock('../useMotorStats', () => ({
  MOTOR_HISTORY_LIMIT: 200,
  useMotorStats: () => ({
    motorStats: mockMotorStats,
    isLoading: loading,
    isError: error != null,
    error,
    refetch: retry,
  }),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

function makeStats(overrides: Partial<MotorStats> = {}): MotorStats {
  return {
    totalReadings: 100,
    avgTorque: 50,
    maxTorque: 200,
    avgMotorTemp: 40,
    maxMotorTemp: 60,
    avgPower: 0,
    peakPower: 0,
    minPower: 0,
    peakRegen: 0,
    highTorquePct: 10,
    ...overrides,
  };
}

function renderTips(stats: MotorStats | null) {
  mockMotorStats = stats;
  return render(<MemoryRouter><DrivingTips vehicleId={1} historyQuery={{ start: '2026-10-01T10:00:00Z', end: '2026-10-01T11:00:00Z' }} /></MemoryRouter>);
}

function items() {
  return within(screen.getByRole('list')).getAllByRole('listitem');
}

beforeEach(() => {
  loading = false;
  error = null;
  retry.mockClear();
});

describe('DrivingTips — persistent shell and semantics', () => {
  it('renders the guidance heading when there is no historical data', () => {
    renderTips(null);
    expect(screen.getByRole('heading', { name: 'How to read this ride' })).toBeInTheDocument();
  });

  it('exposes measured guidance as a semantic list', () => {
    renderTips(makeStats());
    expect(screen.getByRole('list').tagName).toBe('UL');
    expect(items()).toHaveLength(4);
  });

  it('keeps every icon decorative so text carries the meaning', () => {
    renderTips(makeStats());
    for (const item of items()) {
      expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('uses informational icons instead of praise or caution inferred from power', () => {
    renderTips(makeStats({ avgPower: 95, maxMotorTemp: 135 }));
    for (const item of items()) {
      expect(item).toHaveAttribute('data-tone', 'info');
      expect(item.querySelector('svg')).toHaveClass('lucide-lightbulb');
    }
    expect(screen.getByRole('list').querySelector('.lucide-triangle-alert')).toBeNull();
    expect(screen.getByRole('list').querySelector('.lucide-shield-check')).toBeNull();
  });
});

describe('DrivingTips — independent evidence availability', () => {
  it('uses a historical empty state rather than asking to drive to backfill a past trip', () => {
    renderTips(null);
    expect(screen.getByText('No measured motor evidence available for trip-specific guidance.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('does not classify an all-null sample as excellent driving', () => {
    renderTips(makeStats({
      avgPower: null, peakRegen: null, maxTorque: null, maxMotorTemp: null,
    }));
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/Excellent/)).toBeNull();
    expect(screen.getByText(/No measured motor evidence/)).toBeInTheDocument();
  });

  it('explains power only when power was reported', () => {
    renderTips(makeStats({ peakRegen: null, maxTorque: null, maxMotorTemp: null }));
    expect(items()).toHaveLength(1);
    expect(screen.getByText(/Average motor power alone cannot tell/)).toBeInTheDocument();
  });

  it('explains regeneration only when regen was reported', () => {
    renderTips(makeStats({ avgPower: null, maxTorque: null, maxMotorTemp: null }));
    expect(items()).toHaveLength(1);
    expect(screen.getByText(/friction-brake use cannot be reconstructed/)).toBeInTheDocument();
  });

  it('explains missing axle evidence without declaring an axle inactive', () => {
    renderTips(makeStats({ avgPower: null, peakRegen: null, maxMotorTemp: null }));
    expect(items()).toHaveLength(1);
    expect(screen.getByText(/Gaps are missing telemetry/)).toBeInTheDocument();
  });

  it('explains thermal limits without guessing a safe or derating threshold', () => {
    renderTips(makeStats({ avgPower: null, peakRegen: null, maxTorque: null }));
    expect(items()).toHaveLength(1);
    expect(screen.getByText(/do not prove overheating or reduced power/)).toBeInTheDocument();
  });

  it('retains real zero measurements instead of treating zero as absent', () => {
    renderTips(makeStats({ avgPower: 0, peakRegen: 0, maxTorque: 0, maxMotorTemp: 0 }));
    expect(items()).toHaveLength(4);
  });
});

describe('DrivingTips — no arbitrary power boundaries', () => {
  it.each([12, 20, 45, 80, 95])('does not manufacture a driver rating at %s kW', (avgPower) => {
    renderTips(makeStats({ avgPower }));
    expect(screen.getByText(/Average motor power alone cannot tell/)).toBeInTheDocument();
    expect(screen.queryByText(/Excellent driving style/)).toBeNull();
    expect(screen.queryByText(/efficiency by 10–15%/)).toBeNull();
    expect(items().every((item) => item.dataset.tone === 'info')).toBe(true);
  });

  it.each([60, 120, 135])('does not manufacture a thermal diagnosis at %s degrees', (maxMotorTemp) => {
    renderTips(makeStats({ maxMotorTemp }));
    expect(screen.getByText(/Without the vehicle’s limiting signals/)).toBeInTheDocument();
    expect(screen.queryByText(/running high/)).toBeNull();
    expect(items()).toHaveLength(4);
  });
});

describe('DrivingTips — loading and failures', () => {
  it('keeps the heading during loading and does not display advice before measurements', () => {
    loading = true;
    renderTips(null);
    expect(screen.getByRole('heading', { name: 'How to read this ride' })).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText(/No measured motor evidence/)).toBeNull();
  });

  it('renders a retry action for telemetry failure', () => {
    error = new Error('Motor history unavailable');
    renderTips(null);
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/Average motor power alone cannot tell/)).toBeNull();
  });

  it('tolerates a partial degraded payload without filling missing signals with zero', () => {
    renderTips({
      ...makeStats(),
      avgPower: undefined,
      maxMotorTemp: undefined,
    } as unknown as MotorStats);
    expect(items()).toHaveLength(2);
    expect(screen.queryByText(/Average motor power alone cannot tell/)).toBeNull();
    expect(screen.queryByText(/do not prove overheating/)).toBeNull();
    expect(screen.queryByText(/Excellent/)).toBeNull();
  });
});
