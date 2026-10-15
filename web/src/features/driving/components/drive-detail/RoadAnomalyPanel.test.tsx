import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { RoadAnomalyResponse } from '@/types/roadAnomalies';
import { formatDateTime } from '@/lib/dateFormat';
import { gaugeTone } from '@/lib/tokens';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: 'de-DE', settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles' } }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
}));

const mock = vi.hoisted(() => ({
  query: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDriveRoadAnomalies: mock.query,
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatSpeed: (value: number) => `${value} m/s` }),
}));
vi.mock('@/components/maps', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MapTileLayer: () => null,
  MapInvalidator: () => null,
  MarkerCluster: ({ points, onMarkerClick }: {
    points: { id: string; lat: number; lng: number; color: string }[];
    onMarkerClick: (point: { id: string; lat: number; lng: number }) => void;
  }) => <button type="button" data-color={points[0]?.color} onClick={() => onMarkerClick(points[0])}>Select clustered candidate ({points.length})</button>,
}));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: { count?: number }) => {
        if (typeof fallback !== 'string') return key;
        return opts?.count == null ? fallback : fallback.replace('{{count}}', String(opts.count));
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { RoadAnomalyPanel } from './RoadAnomalyPanel';

function setQuery(data?: RoadAnomalyResponse, error?: Error) {
  mock.query.mockImplementation(() => ({
    data,
    error,
    isError: !!error,
    isPending: !data && !error,
    isLoading: !data && !error,
    isFetching: !data && !error,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: mock.refetch,
  }));
}

function renderPanel() {
  render(<MemoryRouter><RoadAnomalyPanel driveId="42" /></MemoryRouter>);
  expect(mock.query).toHaveBeenLastCalledWith('42', true);
  expect(screen.getByRole('button', { name: 'Hide analysis' })).toHaveAttribute('aria-expanded', 'true');
}

describe('RoadAnomalyPanel', () => {
  it('uses warning paint for possible jolts without claiming confirmed potholes', () => {
    setQuery({ drive_id: 42, status: 'candidates', analyzed_samples: 25, limitations: [], candidates: [{ ts: '2026-04-02T08:30:00Z', latitude: 47.6, longitude: -122.3, speed_mps: 12, peak_jerk_g_per_s: 1.5 }] });
    renderPanel();
    expect(screen.getByRole('button', { name: 'Select clustered candidate (1)' })).toHaveAttribute('data-color', gaugeTone.warning);
    expect(screen.getByText('Historical telemetry review — not confirmed potholes')).toBeInTheDocument();
  });
  it('keeps a native disclosure with feature-local mobile targets and dense desktop sizing', () => {
    setQuery({ drive_id: 42, status: 'no_candidates', analyzed_samples: 17, candidates: [], limitations: [] });
    renderPanel();
    const disclosure = screen.getByRole('button', { name: 'Hide analysis' });
    expect(disclosure).toHaveClass('min-h-9');
    expect(disclosure.closest('[class*="max-md:"]')).toHaveClass('max-md:[&_button]:min-h-11', 'max-md:[&_button]:min-w-11');
    disclosure.focus();
    expect(disclosure).toHaveFocus();
  });

  it.each(['2026-04-02T00:30:00Z', '2026-04-02T08:30:00Z', 'invalid', ''])('formats candidate %s with saved preferences and UTC provenance', (ts) => {
    setQuery({ drive_id: 42, status: 'candidates', analyzed_samples: 25, limitations: [], candidates: [{ ts, latitude: 47.6, longitude: -122.3, speed_mps: 12, peak_jerk_g_per_s: 1.5 }] });
    renderPanel();
    const label = formatDateTime(ts, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    const button = screen.getByRole('button', { name: label });
    expect(button.querySelector('time')).toHaveAttribute('datetime', ts);
    expect(button.querySelector('time')).toHaveAttribute('title', ts);
    fireEvent.click(button);
    expect(screen.getByRole('status')).toHaveTextContent(label);
  });

  beforeEach(() => {
    mock.query.mockReset();
    mock.refetch.mockReset();
  });

  it('shows inline evidence immediately and distinguishes insufficient samples', () => {
    setQuery({ drive_id: 42, status: 'insufficient_data', analyzed_samples: 0, candidates: [], limitations: [] });
    renderPanel();
    expect(screen.getByText('Not enough synchronized samples')).toBeInTheDocument();
    expect(screen.getByText(/Missing evidence is not a smooth-road result/)).toBeInTheDocument();
  });

  it('can independently collapse and reopen without introducing tabs', () => {
    setQuery({ drive_id: 42, status: 'no_candidates', analyzed_samples: 17, candidates: [], limitations: [] });
    renderPanel();
    const disclosure = screen.getByRole('button', { name: 'Hide analysis' });
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(mock.query).toHaveBeenLastCalledWith('42', false);
    fireEvent.click(disclosure);
    expect(screen.getByText('No candidates in recorded samples')).toBeVisible();
    expect(mock.query).toHaveBeenLastCalledWith('42', true);
    for (const role of ['tab', 'tablist', 'tabpanel']) {
      expect(screen.queryByRole(role, { hidden: true })).toBeNull();
    }
  });

  it('shows an explicit loading state in the initially open section', () => {
    setQuery();
    renderPanel();
    expect(screen.getByRole('status', { name: 'Loading…' })).toBeVisible();
  });

  it('distinguishes a screened drive with no candidates from missing data', () => {
    setQuery({ drive_id: 42, status: 'no_candidates', analyzed_samples: 17, candidates: [], limitations: [] });
    renderPanel();
    expect(screen.getByText('No candidates in recorded samples')).toBeInTheDocument();
  });

  it('shows evidence and approximate location without calling a candidate a pothole', () => {
    setQuery({
      drive_id: 42,
      status: 'candidates',
      analyzed_samples: 25,
      limitations: [],
      candidates: [{
        ts: '2026-04-01T12:00:00Z',
        latitude: 47.61234,
        longitude: -122.31234,
        speed_mps: 12,
        peak_jerk_g_per_s: 1.5,
      }],
    });
    renderPanel();
    expect(screen.getByRole('region', { name: 'Possible road-anomaly locations' })).toBeInTheDocument();
    expect(screen.getByText(/47\.61234, -122\.31234/)).toBeInTheDocument();
    expect(screen.getByText(/25 acceleration observations screened/)).toBeInTheDocument();
    expect(screen.getByText(/not confirmed potholes/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select clustered candidate (1)' }));
    expect(screen.getByRole('status')).toHaveTextContent('47.61234, -122.31234');
  });

  it('reports a failed initial scan and offers retry', () => {
    setQuery(undefined, new Error('Service unavailable'));
    renderPanel();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mock.refetch).toHaveBeenCalledOnce();
  });
});
