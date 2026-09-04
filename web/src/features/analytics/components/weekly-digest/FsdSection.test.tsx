/**
 * FsdSection — weekly digest supervised-driving panel.
 *
 * Precedence: loading > error > unmeasured empty > measured stats.
 * Null FSD distance is "not measured", never zero. Current-week banner only.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import { fsdInsights } from '@/features/driving/components/fsd-insights/__tests__/fixtures';

import { FsdSection } from './FsdSection';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (meters: number | null, options?: { precision?: number }) =>
      meters == null ? '—' : `${(meters / 1000).toFixed(options?.precision ?? 1)} km`,
  }),
}));

function renderSection(
  over: Partial<Parameters<typeof FsdSection>[0]> = {},
) {
  return render(
    <MemoryRouter>
      <FsdSection
        insights={over.insights}
        isLoading={over.isLoading}
        isError={over.isError}
        error={over.error}
        onRetry={over.onRetry}
        isCurrentWeek={over.isCurrentWeek}
      />
    </MemoryRouter>,
  );
}

describe('FsdSection', () => {
  it('keeps the heading while loading', () => {
    renderSection({ isLoading: true });
    expect(screen.getByText('Supervised driving')).toBeInTheDocument();
    expect(screen.getByTestId('fsd-weekly-section').querySelector('.animate-pulse')).not.toBeNull();
  });

  it('surfaces a retriable error before empty or data', () => {
    const onRetry = vi.fn();
    renderSection({
      isLoading: false,
      isError: true,
      error: new ApiError('fsd down', 500),
      onRetry,
      insights: fsdInsights(),
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Reported FSD')).toBeNull();
  });

  it('treats a missing FSD distance as not measured, not zero', () => {
    const insights = fsdInsights({
      totals: {
        ...fsdInsights().totals,
        fsd_distance_m: null,
        fsd_share_pct: null,
      },
    });
    renderSection({ insights, isCurrentWeek: true });
    expect(
      screen.getByText('No supervised-driving distance was measured this week.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0.0 km/)).toBeNull();
  });

  it('shows this-week vs last-week stats and a current-week notice', () => {
    const insights = fsdInsights({
      totals: {
        ...fsdInsights().totals,
        fsd_distance_m: 16_000,
        fsd_share_pct: 25,
      },
    });
    insights.drive_analytics.comparison.fsd_distance_change_m = 2_000;
    insights.drive_analytics.comparison.fsd_share_change_pct_points = 4;

    renderSection({ insights, isCurrentWeek: true });

    expect(screen.getByText('This week vs last week')).toBeInTheDocument();
    expect(screen.getByText('16.0 km')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText('+4.0 pts')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open FSD insights' })).toHaveAttribute(
      'href',
      '/fsd?days=7',
    );
  });

  it('omits the current-week notice when browsing a past week', () => {
    renderSection({ insights: fsdInsights(), isCurrentWeek: false });
    expect(screen.queryByText('This week vs last week')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open FSD insights' })).toBeInTheDocument();
  });
});
