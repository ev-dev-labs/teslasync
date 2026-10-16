import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FsdObservatoryPanel } from './FsdObservatoryPanel';
import { fsdInsights } from './__tests__/fixtures';
import type { FsdSectionState } from './types';
import { deriveDataState } from '@/api/dataState';
import type { FsdInsights } from '@/types/fsd';
import { neonColorMap, typography } from '@/lib/tokens';

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
    const insights = structuredClone(fsdInsights());
    insights.drive_analytics.observatory.timeline[0].at = '2026-08-26T15:15:00Z';
    insights.drive_analytics.observatory.truncated = true;
    renderPanel(<FsdObservatoryPanel insights={insights} state={readyState} />);
    const link = screen.getByRole('link', { name: 'preferred:2026-08-26T15:15:00Z' });
    expect(link).toHaveAttribute('href', '/drives/280');
    expect(link).toHaveClass(
      'text-[var(--text-primary)]', 'hover:bg-[var(--control-bg-hover)]',
      'focus-visible:outline-2', 'min-h-11', 'min-w-11', 'md:min-h-0', 'md:min-w-0',
    );
    link.focus();
    expect(link).toHaveFocus();
    expect(screen.getByText('Oldest drives were omitted so every counter reset still appears.'))
      .toHaveClass(neonColorMap.amber.text);
    expect(screen.getByTestId('fsd-observatory').querySelector('h3 svg'))
      .toHaveClass(typography.color.muted);
  });

  it('renders the stitched journal without claiming engagement segments', () => {
    renderPanel(<FsdObservatoryPanel insights={fsdInsights()} state={readyState} />);

    const panel = screen.getByTestId('fsd-observatory');
    expect(within(panel).getByText('FSD observatory')).toBeInTheDocument();
    expect(within(within(panel).getByRole('region', { name: 'Reset-safe counter quantities' }))
      .getByText(/reset-safe counter change/i)).toBeInTheDocument();
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
    const insights = structuredClone(fsdInsights());
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

  it('forwards active initial loading without displaying empty results or metrics', () => {
    const dataState = deriveDataState<FsdInsights>({ isPending: true, isFetching: true, fetchStatus: 'fetching' });
    renderPanel(<FsdObservatoryPanel insights={undefined} state={readyState} dataState={dataState} />);

    expect(screen.getByRole('status', { name: 'Loading supervised self-driving telemetry' })).toBeInTheDocument();
    expect(screen.queryByText('No completed drives in this period to journal.')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Reset-safe counter quantities' })).not.toBeInTheDocument();
  });

  it('distinguishes paused initial loading from active loading and successful empty results', () => {
    const dataState = deriveDataState<FsdInsights>({ isPending: true, fetchStatus: 'paused' });
    renderPanel(<FsdObservatoryPanel insights={undefined} state={{ ...readyState, isLoading: true }} dataState={dataState} />);

    expect(screen.getByRole('status')).toHaveTextContent('Refresh paused');
    expect(screen.queryByRole('status', { name: 'Loading supervised self-driving telemetry' })).not.toBeInTheDocument();
    expect(screen.queryByText('No completed drives in this period to journal.')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0 km')).not.toBeInTheDocument();
  });

  it('renders successful empty journals and measured zero totals as returned evidence', () => {
    const insights = structuredClone(fsdInsights());
    insights.drive_analytics.observatory.timeline = [];
    insights.drive_analytics.observatory.commute_stories = [];
    insights.drive_analytics.observatory.totals = {
      ...insights.drive_analytics.observatory.totals,
      stitched_fsd_distance_m: 0,
      ambiguous_fsd_distance_m: 0,
      unknown_drive_distance_m: 0,
      unknown_drive_count: 0,
      reset_break_count: 0,
    };
    const dataState = deriveDataState({ data: insights, isSuccess: true }, { provenance: 'historical' });
    renderPanel(<FsdObservatoryPanel insights={undefined} state={readyState} dataState={dataState} />);

    expect(screen.getAllByText('0.0 km')).toHaveLength(3);
    expect(screen.getByText('No completed drives in this period to journal.')).toBeInTheDocument();
    expect(screen.getByText('Not enough repeated routes yet for a commute story.')).toBeInTheDocument();
    assertOperationalBriefDisclosure(document.body, 'Returned evidence');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('retains every metric and table through refresh failure, retry and recovery', () => {
    const insights = fsdInsights();
    const retry = vi.fn();
    const failed = deriveDataState({
      data: insights, error: new Error('Refresh failed'), isError: true,
      dataUpdatedAt: 1_777_000_000_000, refetch: retry,
    }, { provenance: 'historical' });
    const { rerender } = renderPanel(
      <FsdObservatoryPanel insights={insights} state={{ ...readyState, error: failed.refreshError }} dataState={failed} />,
    );

    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    assertOperationalBriefDisclosure(document.body, 'Retained source');
    expect(screen.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'stale');
    const brief = screen.getByRole('region', { name: 'Reset-safe counter quantities' });
    for (const value of ['14.0 km', '1.0 km', '5.0 km', '1']) {
      expect(within(brief).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByRole('table', { name: 'Stitched journal' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Commute stories' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();

    const refreshing = deriveDataState({ data: insights, isFetching: true, refetch: retry }, { provenance: 'historical' });
    rerender(<MemoryRouter><FsdObservatoryPanel insights={insights} state={{ ...readyState, isLoading: true }} dataState={refreshing} /></MemoryRouter>);
    assertOperationalBriefDisclosure(document.body, 'Retained source');
    expect(screen.getByRole('table', { name: 'Stitched journal' })).toBeInTheDocument();

    const recovered = deriveDataState({ data: insights, isSuccess: true, refetch: retry }, { provenance: 'historical' });
    rerender(<MemoryRouter><FsdObservatoryPanel insights={insights} state={readyState} dataState={recovered} /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Retained source')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(document.body, 'Returned evidence');
    expect(screen.getByLabelText('Historical')).toHaveAttribute('data-data-status', 'ok');
    expect(screen.getByRole('table', { name: 'Commute stories' })).toBeInTheDocument();
  });

  it('keeps legacy retained data visible when a refresh error is passed', () => {
    renderPanel(<FsdObservatoryPanel insights={fsdInsights()} state={{ ...readyState, error: new Error('Refresh failed') }} />);
    assertOperationalBriefDisclosure(document.body, 'Retained source');
    expect(screen.getByRole('table', { name: 'Stitched journal' })).toBeInTheDocument();
  });

  it('retains paused evidence without inventing a refresh failure', () => {
    const dataState = deriveDataState({
      data: fsdInsights(), fetchStatus: 'paused', refetch: vi.fn(),
    }, { provenance: 'historical' });
    renderPanel(<FsdObservatoryPanel insights={undefined} state={readyState} dataState={dataState} />);
    expect(dataState.refreshError).toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    assertOperationalBriefDisclosure(document.body, 'Retained source');
    expect(screen.getByRole('table', { name: 'Stitched journal' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Commute stories' })).toBeInTheDocument();
  });

  it('forwards fatal errors without replacing the panel shell', () => {
    const retry = vi.fn();
    const dataState = deriveDataState<FsdInsights>({ error: new Error('Initial failure'), refetch: retry });
    renderPanel(<FsdObservatoryPanel insights={undefined} state={readyState} dataState={dataState} />);
    expect(screen.getByText('FSD observatory')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Stitched journal' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
