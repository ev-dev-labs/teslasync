/**
 * FsdWeeklyWidget — this week vs last week FSD, with null remaining null.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { fsdInsights } from '@/features/driving/components/fsd-insights/__tests__/fixtures';
import type { WidgetSize } from './types';

const { fsdRangeMock, vehiclesMock, unitsMock } = vi.hoisted(() => ({
  fsdRangeMock: vi.fn(),
  vehiclesMock: vi.fn(),
  unitsMock: vi.fn(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({
  useFsdInsightsRange: (...args: unknown[]) => fsdRangeMock(...args),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

vi.mock('@/lib/timezone', () => ({
  browserTimezone: () => 'UTC',
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interp = (tpl: string, opts?: Record<string, unknown>) =>
    opts ? tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : '')) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) =>
        typeof fallback === 'string' ? interp(fallback, opts) : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import FsdWeeklyWidget from './FsdWeeklyWidget';

const size: WidgetSize = { cols: 2, rows: 2 };

function renderWidget(over: Partial<{ vehicleId: number; cols: number }> = {}) {
  return render(
    <MemoryRouter>
      <FsdWeeklyWidget
        vehicleId={over.vehicleId ?? 7}
        size={{ ...size, cols: over.cols ?? 2 }}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  unitsMock.mockReturnValue({
    formatDistance: (meters: number | null, options?: { precision?: number }) =>
      meters == null ? '—' : `${(meters / 1000).toFixed(options?.precision ?? 1)} km`,
  });
  fsdRangeMock.mockReturnValue({
    data: fsdInsights({
      totals: {
        ...fsdInsights().totals,
        fsd_distance_m: 16_000,
        fsd_share_pct: 40,
      },
      drive_analytics: {
        ...fsdInsights().drive_analytics,
        comparison: {
          ...fsdInsights().drive_analytics.comparison,
          fsd_share_change_pct_points: 3,
        },
      },
    }),
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
  });
});

describe('FsdWeeklyWidget', () => {
  it('shows this week FSD, share, last-week change, and drill-through links', () => {
    renderWidget();

    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16.0 km');
    expect(screen.getByTestId('fsd-weekly-share')).toHaveTextContent('40.0%');
    expect(screen.getByTestId('fsd-weekly-change')).toHaveTextContent('+3.0 pts');
    expect(screen.getByRole('link', { name: 'FSD Insights' })).toHaveAttribute('href', '/fsd');
    expect(screen.getByRole('link', { name: 'Weekly digest' })).toHaveAttribute('href', '/weekly-digest');
  });

  it('renders an em dash instead of zero when FSD was not measured', () => {
    fsdRangeMock.mockReturnValue({
      data: fsdInsights({
        totals: {
          ...fsdInsights().totals,
          fsd_distance_m: null,
          fsd_share_pct: null,
        },
        drive_analytics: {
          ...fsdInsights().drive_analytics,
          comparison: {
            ...fsdInsights().drive_analytics.comparison,
            fsd_share_change_pct_points: null,
          },
        },
      }),
      isLoading: false,
      error: null,
      isFetching: false,
      isStale: false,
      isError: false,
      dataUpdatedAt: Date.now(),
      refetch: vi.fn(),
    });

    renderWidget();

    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('—');
    expect(screen.getByTestId('fsd-weekly-share')).toHaveTextContent('—');
    expect(screen.getByTestId('fsd-weekly-change')).toHaveTextContent('—');
    expect(screen.queryByText('0.0 km')).not.toBeInTheDocument();
  });
});
