import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { FsdDriveAnalyticsPanels } from './FsdDriveAnalyticsPanels';
import { fsdInsights } from './__tests__/fixtures';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km' },
    formatDistance: (meters: number | null, options?: { precision?: number }) =>
      meters == null ? '-' : `${(meters / 1000).toFixed(options?.precision ?? 1)} km`,
  }),
}));

const readyState = {
  isLoading: false,
  error: null,
  onRetry: vi.fn(),
  noVehicle: false,
};

describe('FsdDriveAnalyticsPanels', () => {
  it('renders period comparison, attribution, drives, groups, and correlation caveat', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={fsdInsights()} state={readyState} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Change from the previous period')).toBeInTheDocument();
    expect(screen.getByText('Attribution and counter resets')).toBeInTheDocument();
    expect(screen.getByText('Contributing drives')).toBeInTheDocument();
    expect(screen.getByText('Route, time, and firmware comparisons')).toBeInTheDocument();
    expect(screen.getByText('Same-route efficiency comparison')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /2026/ })).toHaveAttribute('href', '/drives/295');
    expect(screen.getAllByText('Home to Office').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026.20.3').length).toBeGreaterThan(0);
    expect(screen.getByText(/correlation, not proof/)).toBeInTheDocument();
  });

  it('keeps every panel shell visible while loading', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels
          insights={undefined}
          state={{ ...readyState, isLoading: true }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Change from the previous period')).toBeInTheDocument();
    expect(screen.getByText('Attribution and counter resets')).toBeInTheDocument();
    expect(screen.getByText('Contributing drives')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(5);
  });

  it('explains when period deltas lack comparable trusted coverage', () => {
    const insights = fsdInsights();
    insights.drive_analytics.comparison.fsd_distance_change_m = null;
    insights.drive_analytics.comparison.fsd_share_change_pct_points = null;

    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Periods lack comparable trusted coverage')).toBeInTheDocument();
    expect(screen.getByText('Share periods lack comparable trusted coverage')).toBeInTheDocument();
  });

  it('keeps missing legacy attribution unavailable instead of showing zero', () => {
    const legacy = fsdInsights() as unknown as ReturnType<typeof fsdInsights> & {
      drive_analytics?: undefined;
    };
    delete legacy.drive_analytics;

    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={legacy} state={readyState} />
      </MemoryRouter>,
    );

    const attribution = screen.getByTestId('fsd-attribution');
    const unknown = within(attribution).getByText('Drive distance unknown').parentElement;
    expect(unknown).not.toBeNull();
    expect(within(unknown as HTMLElement).getByText('Not measured')).toBeInTheDocument();
  });
});
