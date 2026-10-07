import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { RoadAnomalyResponse } from '@/types/roadAnomalies';

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
    points: { id: string; lat: number; lng: number }[];
    onMarkerClick: (point: { id: string; lat: number; lng: number }) => void;
  }) => <button type="button" onClick={() => onMarkerClick(points[0])}>Select clustered candidate ({points.length})</button>,
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
  expect(mock.query).toHaveBeenCalledWith('42', false);
  fireEvent.click(screen.getByRole('button', { name: 'Review road surface' }));
  expect(mock.query).toHaveBeenLastCalledWith('42', true);
}

describe('RoadAnomalyPanel', () => {
  beforeEach(() => {
    mock.query.mockReset();
    mock.refetch.mockReset();
  });

  it('does not scan history until opened and distinguishes insufficient samples', () => {
    setQuery({ drive_id: 42, status: 'insufficient_data', analyzed_samples: 0, candidates: [], limitations: [] });
    renderPanel();
    expect(screen.getByText('Not enough synchronized samples')).toBeInTheDocument();
    expect(screen.getByText(/Missing evidence is not a smooth-road result/)).toBeInTheDocument();
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
