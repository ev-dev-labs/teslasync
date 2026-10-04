import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FsdObservatoryPanel } from './FsdObservatoryPanel';
import { fsdInsights } from './__tests__/fixtures';
import type { FsdSectionState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) =>
      Object.entries(typeof fallback === 'object' ? fallback : values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        typeof fallback === 'string' ? fallback
          : typeof fallback?.defaultValue === 'string' ? fallback.defaultValue : key,
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

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: string) => `preferred:${value}`,
  }),
}));

const readyState: FsdSectionState = {
  isLoading: false,
  error: null,
  onRetry: vi.fn(),
  noVehicle: false,
};

function renderPanel(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FsdObservatoryPanel', () => {
  it('renders journal dates with the preference-aware formatter', () => {
    const insights = fsdInsights();
    insights.drive_analytics.observatory.timeline[0].at = '2026-08-26T15:15:00Z';
    renderPanel(<FsdObservatoryPanel insights={insights} state={readyState} />);
    expect(screen.getByRole('link', { name: 'preferred:2026-08-26T15:15:00Z' }))
      .toHaveAttribute('href', '/drives/280');
  });

  it('renders the stitched journal without claiming engagement segments', () => {
    renderPanel(<FsdObservatoryPanel insights={fsdInsights()} state={readyState} />);

    const panel = screen.getByTestId('fsd-observatory');
    expect(within(panel).getByText('FSD observatory')).toBeInTheDocument();
    expect(within(panel).getByText(/reset-safe counter change/i)).toBeInTheDocument();
    expect(within(panel).getByText('14.0 km')).toBeInTheDocument();
    expect(within(panel).getByText('1.0 km')).toBeInTheDocument();
    expect(within(panel).getByText('5.0 km')).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/FSD-active/i);
    expect(panel.textContent).not.toMatch(/exact engagement/i);

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/drives/295');
    expect(screen.getByTestId('fsd-observatory-reset')).toHaveTextContent('not travelled FSD');
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Home to Office').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Stitched journal' })).toBeInTheDocument();
    const commute = screen.getByRole('table', { name: 'Commute stories' });
    const chapter = within(commute).getByText('2026.8.1').closest('tr')!;
    expect(chapter.querySelector('[data-column-key="unknown"]')).toHaveTextContent('1');
    expect(chapter.querySelector('[data-column-key="reportedFsd"]')).toHaveTextContent('Not measured');
  });

  it('keeps missing stitched FSD as an em dash instead of zero', () => {
    const insights = fsdInsights();
    insights.drive_analytics.observatory.totals.stitched_fsd_distance_m = null;
    insights.drive_analytics.observatory.totals.ambiguous_fsd_distance_m = null;
    insights.drive_analytics.observatory.timeline = [{
      kind: 'drive',
      at: '2026-03-02T17:00:00Z',
      end_at: '2026-03-02T17:30:00Z',
      drive_id: 295,
      route_key: 'place:home:office',
      route_label: 'Home to Office',
      firmware_version: null,
      fsd_distance_m: null,
      driving_distance_m: 10_000,
      confidence: 'unknown',
      reset_break: false,
      approximate: false,
      field: null,
    }];

    renderPanel(<FsdObservatoryPanel insights={insights} state={readyState} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByTestId('fsd-observatory-drive-fsd')).toHaveTextContent('Not measured');
    expect(screen.queryByText('0.0 km')).not.toBeInTheDocument();
  });

  it('pages the stitched journal with the shared pagination control', () => {
    const insights = structuredClone(fsdInsights());
    insights.drive_analytics.observatory.timeline = Array.from({ length: 26 }, (_, index) => ({
      kind: 'drive' as const,
      at: `2026-03-01T10:${String(index).padStart(2, '0')}:00Z`,
      end_at: `2026-03-01T10:${String(index).padStart(2, '0')}:30Z`,
      drive_id: 1000 + index,
      route_key: `route:${index}`,
      route_label: `Route ${index}`,
      firmware_version: null,
      fsd_distance_m: 1_000,
      driving_distance_m: 2_000,
      confidence: 'high' as const,
      reset_break: false,
      approximate: false,
      field: null,
    }));

    renderPanel(<FsdObservatoryPanel insights={insights} state={readyState} />);

    const journal = screen.getByTestId('fsd-observatory-timeline');
    expect(journal.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(screen.getByText('Showing 1–25 of 26')).toBeInTheDocument();

    const next = screen.getAllByRole('button', { name: 'Next page' })
      .find((button) => !button.hasAttribute('disabled'));
    expect(next).toBeDefined();
    fireEvent.click(next!);
    expect(journal.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(screen.getByText('Showing 26–26 of 26')).toBeInTheDocument();
  });

  it('pages all firmware chapters with the integrated grid footer', () => {
    const insights = structuredClone(fsdInsights());
    const seed = insights.drive_analytics.observatory.commute_stories[0];
    insights.drive_analytics.observatory.commute_stories = Array.from({ length: 26 }, (_, index) => ({
      ...seed,
      route_key: `route:${index}`,
      route_label: `Commute ${index}`,
    }));

    renderPanel(<FsdObservatoryPanel insights={insights} state={readyState} />);

    const commute = screen.getByTestId('fsd-observatory-commute');
    expect(commute.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(within(commute).getByText('Showing 1–25 of 52')).toBeInTheDocument();

    const next = within(commute).getAllByRole('button', { name: 'Next page' })
      .find((button) => !button.hasAttribute('disabled'));
    expect(next).toBeDefined();
    fireEvent.click(next!);
    expect(within(commute).getByText('Showing 26–50 of 52')).toBeInTheDocument();
    fireEvent.click(next!);
    expect(commute.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(within(commute).getByText('Showing 51–52 of 52')).toBeInTheDocument();
  });

  it('keeps routes with no firmware chapters visible without inventing counts or distance', () => {
    const insights = structuredClone(fsdInsights());
    insights.drive_analytics.observatory.commute_stories[0].chapters = [];
    renderPanel(<FsdObservatoryPanel insights={insights} state={readyState} />);
    const table = screen.getByRole('table', { name: 'Commute stories' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(within(table).getByText('Unknown firmware')).toBeInTheDocument();
    expect(within(table).getByText('Not measured')).toBeInTheDocument();
    expect(table.querySelector('tbody [data-column-key="chapterDrives"]')).toHaveTextContent('—');
  });

  it('keeps the observatory shell visible while loading', () => {
    renderPanel(
      <FsdObservatoryPanel
        insights={undefined}
        state={{ ...readyState, isLoading: true }}
      />,
    );

    expect(screen.getByTestId('fsd-observatory')).toBeInTheDocument();
    expect(screen.getByText('FSD observatory')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
