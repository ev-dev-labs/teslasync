import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MediaSnapshot } from '@/api/types';
import type { WidgetSize } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      return options && typeof fallback === 'string'
        ? template.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useVehiclesMock, useMediaLatestMock } = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useMediaLatestMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
  useMediaLatest: (id: number, interval?: number) => useMediaLatestMock(id, interval),
}));

import MediaNowPlayingWidget, { progressPercent, volumePercent } from './MediaNowPlayingWidget';

function makeMedia(overrides: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    now_playing_title: 'Night Highway',
    now_playing_artist: 'The Coastlines',
    now_playing_album: 'Signals',
    now_playing_station: 'Radio',
    now_playing_duration: 221_000,
    now_playing_elapsed: 84_000,
    playback_status: 'Playing',
    playback_source: 'Spotify',
    audio_volume: 5,
    audio_volume_max: 10,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeResult(overrides: Record<string, unknown> = {}) {
  return {
    data: makeMedia(),
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <MediaNowPlayingWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVehiclesMock.mockReset();
  useMediaLatestMock.mockReset();
  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useMediaLatestMock.mockReturnValue(makeResult());
});

describe('media now playing helpers', () => {
  it('bounds playback progress without non-finite or negative values', () => {
    expect(progressPercent(84_000, 221_000)).toBeCloseTo(38.009);
    expect(progressPercent(50, 0)).toBe(0);
    expect(progressPercent(-10, 200)).toBe(0);
    expect(progressPercent(300, 200)).toBe(100);
  });

  it('bounds volume and guards an unusable scale', () => {
    expect(volumePercent(5, 10)).toBe(50);
    expect(volumePercent(15, 10)).toBe(100);
    expect(volumePercent(5, 0)).toBe(0);
  });
});

describe('MediaNowPlayingWidget redesign', () => {
  it('renders the After-card hierarchy with title, artist and source, and one progress meter', () => {
    renderWidget();
    expect(screen.getByText('Night Highway')).toBeInTheDocument();
    expect(screen.getByText('The Coastlines · Spotify')).toBeInTheDocument();
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'Playback progress' });
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(screen.getByText('1:24')).toBeInTheDocument();
    expect(screen.getByText('3:41')).toBeInTheDocument();
  });

  it('uses explicit vehicle id and keeps the shared 5-second live polling cadence', () => {
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(useMediaLatestMock).toHaveBeenCalledWith(42, 5000);
  });

  it('strips title and source labels in compact layout while preserving identity', () => {
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.queryByText('Now playing')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Night Highway')).toBeInTheDocument();
    expect(screen.getByText('The Coastlines')).toBeInTheDocument();
  });

  it('does not fabricate volume, status, album, or separate labels', () => {
    renderWidget();
    expect(screen.queryByText('Playing')).not.toBeInTheDocument();
    expect(screen.queryByText('Volume')).not.toBeInTheDocument();
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();
  });

  it('omits the progress bar when elapsed or duration is missing', () => {
    useMediaLatestMock.mockReturnValue(makeResult({
      data: makeMedia({ now_playing_elapsed: undefined, now_playing_duration: 221_000 }),
    }));
    renderWidget();
    expect(screen.queryByRole('progressbar', { name: 'Playback progress' })).not.toBeInTheDocument();
    expect(screen.queryByText('0:00')).not.toBeInTheDocument();
  });

  it('falls back to station when playback source is absent', () => {
    useMediaLatestMock.mockReturnValue(makeResult({
      data: makeMedia({ playback_source: undefined, now_playing_station: 'TuneIn' }),
    }));
    renderWidget();
    expect(screen.getByText('The Coastlines · TuneIn')).toBeInTheDocument();
  });

  it('renders loading and empty states honestly', () => {
    useMediaLatestMock.mockReturnValue(makeResult({ data: undefined, isLoading: true }));
    const first = renderWidget();
    expect(first.container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    first.unmount();

    useMediaLatestMock.mockReturnValue(makeResult({ data: null }));
    renderWidget();
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
  });

  it('retains cached media and exposes refresh recovery on background failure', () => {
    const refetch = vi.fn();
    useMediaLatestMock.mockReturnValue(makeResult({
      isError: true,
      error: new Error('refresh failed'),
      refetch,
    }));
    renderWidget();
    expect(screen.getByText('Night Highway')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
