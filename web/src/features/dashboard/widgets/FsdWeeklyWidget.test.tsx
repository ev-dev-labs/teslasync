/**
 * FsdWeeklyWidget — this week vs last week FSD, with null remaining null.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { fsdInsights } from '@/features/driving/components/fsd-insights/__tests__/fixtures';
import type { WidgetSize } from './types';
import { fmtNumber } from '@/lib/numberFormat';

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
    unitPrefs: { distance: 'km', locale: 'en-US' },
    formatDistance: (meters: number | null) =>
      meters == null ? '—' : `${fmtNumber(meters / 1000)} km`,
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
  describe.each([1, 2, 3])('identifying heading at cols=%i', (cols) => {
    it.each(['populated', 'loading', 'empty', 'initial failure', 'retained failure'] as const)(
      'keeps exactly one visible shell heading when %s',
      (state) => {
        if (state === 'loading') fsdRangeMock.mockReturnValue({ ...fsdRangeMock(), data: undefined, isLoading: true });
        if (state === 'empty') fsdRangeMock.mockReturnValue({ ...fsdRangeMock(), data: undefined });
        if (state === 'initial failure' || state === 'retained failure') {
          fsdRangeMock.mockReturnValue({
            ...fsdRangeMock(),
            ...(state === 'initial failure' ? { data: undefined } : {}),
            isError: true,
            error: new Error('offline'),
          });
        }
        const { container } = renderWidget({ cols, ...(state === 'empty' ? { vehicleId: 0 } : {}) });
        const headings = screen.getAllByRole('heading', { name: 'FSD this week', level: 3 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toBeVisible();
        if (state === 'populated' || state === 'retained failure') {
          expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16.00 km');
          expect(screen.getByText('40.00%')).toBeInTheDocument();
          if (cols > 1) expect(screen.getByRole('link', { name: 'FSD insights' })).toHaveAttribute('href', '/fsd');
        }
        if (state === 'loading') expect(container.querySelector('[class*="--skeleton-bg"]')).toBeInTheDocument();
        if (state === 'empty') expect(screen.getByText('Select a vehicle')).toBeInTheDocument();
        if (state === 'initial failure') expect(screen.getByRole('alert')).toBeInTheDocument();
        if (state === 'retained failure') expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      },
    );
  });

  it('keeps measured values and drill-through links when refreshing fails', () => {
    fsdRangeMock.mockReturnValue({
      ...fsdRangeMock(),
      isError: true,
      error: new Error('offline'),
      fetchStatus: 'paused',
    });
    renderWidget();
    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16.00 km');
    expect(screen.getByText('40.00%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'FSD insights' })).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
  });
  it('shows this week FSD, share, last-week change, and drill-through links', () => {
    renderWidget();

    expect(screen.getByTestId('fsd-weekly-distance')).toHaveTextContent('16.00 km');
    expect(screen.getByText('40.00%')).toBeInTheDocument();
    expect(screen.getByText('+3.00 pts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'FSD insights' })).toHaveAttribute('href', '/fsd');
    expect(screen.getByRole('link', { name: 'Weekly digest' })).toHaveAttribute('href', '/weekly-digest');
  });

  it('reviews source-backed FSD metrics and exact exclusive bounds without replacing drill-through links', () => {
    renderWidget();
    const brief = screen.getByTestId('fsd-weekly-operational-brief');
    expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(3);
    expect(within(brief).getByText(/exclusive · UTC/)).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('16.00 km')).toBeInTheDocument();
    expect(within(drawer).getByText('+3.00 pts')).toBeInTheDocument();
    expect(within(drawer).getByText(/not a percent growth rate/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Weekly digest' })).toBeInTheDocument();
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
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('0.00 km')).not.toBeInTheDocument();
  });
});
