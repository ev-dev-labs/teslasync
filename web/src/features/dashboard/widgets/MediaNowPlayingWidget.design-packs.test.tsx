import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { request } from '@/api/client';
import type { MediaSnapshot } from '@/api/types';
import MediaNowPlayingWidget from './MediaNowPlayingWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      const values = typeof fallback === 'object' ? fallback : options;
      return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(values?.[name] ?? match));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const fixture: MediaSnapshot = {
  vehicle_id: 42,
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
};
const packs = Object.entries(PACK_APPEARANCES);
const full: WidgetSize = { cols: 2, rows: 2 };
const compact: WidgetSize = { cols: 1, rows: 1 };
const clients: QueryClient[] = [];
const mockRequest = vi.mocked(request);
let media: MediaSnapshot | null;
let mediaError: Error | null;
let pendingMedia: Promise<MediaSnapshot | null> | undefined;
const mediaCalls = () => mockRequest.mock.calls.filter(([path]) => path.startsWith('/media/latest'));

function renderWidget(packId: unknown = 'classic', size = full, vehicleId: number | undefined = 42) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <MediaNowPlayingWidget vehicleId={vehicleId} size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

async function expectAppearance(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector(
    `[data-widget-family="media"][data-widget-appearance="${appearance}"]`,
  )).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  media = { ...fixture };
  mediaError = null;
  pendingMedia = undefined;
  mockRequest.mockImplementation(path => {
    if (path === '/vehicles') return Promise.resolve([{ id: 7 }]);
    if (path.startsWith('/media/latest')) {
      return mediaError ? Promise.reject(mediaError) : pendingMedia ?? Promise.resolve(media);
    }
    return Promise.reject(new Error(`Unexpected request: ${path}`));
  });
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe.each(packs)('media now playing %s (%s)', (packId, appearance) => {
  it('uses the real media presentation, track identity, music artwork and exact playback clock/scale', async () => {
    const { container } = renderWidget(packId);
    await expectAppearance(container, appearance);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    expect(screen.getByRole('heading', { name: 'Now playing' })).toBeVisible();
    expect(screen.getByText('Night Highway')).toBeVisible();
    expect(screen.getByText('The Coastlines · Spotify')).toBeVisible();
    expect(container.querySelector('[data-instrument-family="media"] .lucide-music')).toBeInTheDocument();
    expect(screen.getByText('1:24')).toBeInTheDocument();
    expect(screen.getByText('3:41')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'Playback progress' });
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '100');
    expect(Number(progress.getAttribute('aria-valuenow'))).toBeCloseTo(38.009);
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    for (const hidden of ['Volume', 'Playing', 'Signals', '0:00']) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    }
    expect(mediaCalls()).toHaveLength(1);
    expect(mediaCalls()[0][0]).toBe('/media/latest?vehicle_id=42');
    if (packId === 'v7') {
      expect(progress.querySelector('[data-metric-fill]')).toBeNull();
      expect(progress.querySelector('[data-metric-track]')).toBeInTheDocument();
    }
  });

  it('retains the compact identity without adding source, playback controls or a synthetic meter', async () => {
    const { container } = renderWidget(packId, compact);
    await expectAppearance(container, appearance);
    expect(screen.getByText('Night Highway')).toBeInTheDocument();
    expect(screen.getByText('The Coastlines')).toBeInTheDocument();
    expect(screen.queryByText('Now playing')).not.toBeInTheDocument();
    expect(screen.queryByText(/Spotify/)).not.toBeInTheDocument();
    expect(screen.queryByText('1:24')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('keeps the empty media shell and does not invent a zero reading', async () => {
    media = null;
    const { container } = renderWidget(packId);
    await expectAppearance(container, appearance);
    expect(screen.getByRole('heading', { name: 'Now playing' })).toBeInTheDocument();
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="unavailable"]')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText('0:00')).not.toBeInTheDocument();
  });

  it('keeps unknown identity and missing progress honest rather than using reference sample data', async () => {
    media = { now_playing_title: ' ', now_playing_artist: null, now_playing_duration: null };
    const { container } = renderWidget(packId);
    await expectAppearance(container, appearance);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Playback progress depends on available media signals.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByText('0:00')).not.toBeInTheDocument();
    expect(screen.queryByText('Night Highway')).not.toBeInTheDocument();
    expect(screen.queryByText('Catalogue evening drive')).not.toBeInTheDocument();
  });

  it('retains cached media, source trust and refresh recovery after a failed background read', async () => {
    const { container } = renderWidget(packId);
    await expectAppearance(container, appearance);
    mediaError = new Error('Media source unavailable');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await waitFor(() => expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument());
    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.getByText('Night Highway')).toBeInTheDocument();
    expect(screen.getByText('1:24')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Playback progress' })).toBeInTheDocument();
    expect(mediaCalls()).toHaveLength(2);
    mediaError = null;
    media = { ...fixture, now_playing_title: 'Morning Coast' };
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await waitFor(() => expect(screen.getByText('Morning Coast')).toBeInTheDocument());
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(mediaCalls()).toHaveLength(3);
  });
});

describe('media controller preservation', () => {
  it('keeps the loading shell without fabricating a song, then renders the selected pack', async () => {
    const response: { resolve?: (value: MediaSnapshot) => void } = {};
    pendingMedia = new Promise(resolve => { response.resolve = resolve; });
    const { container } = renderWidget('v1');
    await waitFor(() => expect(mediaCalls()).toHaveLength(1));
    expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Night Highway')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    response.resolve?.(fixture);
    await expectAppearance(container, 'studio');
    await screen.findByText('Night Highway');
  });

  it('exposes fatal read recovery without claiming empty media, then reuses the selected presentation', async () => {
    mediaError = new Error('Media source unavailable');
    const { container } = renderWidget('v1');
    await waitFor(() => expect(container.querySelector('[data-data-state="initialFailure"]')).toBeInTheDocument());
    expect(screen.queryByText('Nothing playing')).not.toBeInTheDocument();
    expect(screen.queryByText('Night Highway')).not.toBeInTheDocument();
    mediaError = null;
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    await expectAppearance(container, 'studio');
    await screen.findByText('Night Highway');
    expect(mediaCalls()).toHaveLength(2);
  });

  it('switches every production pack on one controller and returns to the original Classic body', async () => {
    const view = renderWidget();
    await screen.findByText('Night Highway');
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    for (const [packId, appearance] of packs) {
      view.selectPack(packId);
      await expectAppearance(view.container, appearance);
      expect(screen.getByText('The Coastlines · Spotify')).toBeInTheDocument();
      expect(mediaCalls()).toHaveLength(1);
    }
    view.selectPack('classic');
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getByText('Night Highway')).toBeInTheDocument();
    expect(screen.getByText('1:24')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Playback progress' })).toBeInTheDocument();
    expect(mediaCalls()).toHaveLength(1);
  });

  it.each(['classic', 'unknown-pack'])('preserves %s recovery with station fallback and no fabricated metadata', async packId => {
    media = { ...fixture, playback_source: null, now_playing_station: 'TuneIn' };
    const { container } = renderWidget(packId);
    await screen.findByText('The Coastlines · TuneIn');
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', 'classic');
    expect(container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.getByText('1:24')).toBeInTheDocument();
    expect(screen.queryByText('Signals')).not.toBeInTheDocument();
  });

  it.each([
    { now_playing_elapsed: -1 },
    { now_playing_elapsed: Number.NaN },
    { now_playing_duration: 0 },
    { now_playing_duration: Number.POSITIVE_INFINITY },
  ])('does not turn invalid timing %j into zero progress', async invalid => {
    media = { ...fixture, ...invalid };
    const { container } = renderWidget('v7');
    await expectAppearance(container, 'pixel');
    expect(screen.getByText('Playback progress depends on available media signals.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('0:00')).not.toBeInTheDocument();
  });

  it('does not confuse measured zero elapsed time with missing progress', async () => {
    media = { ...fixture, now_playing_elapsed: 0 };
    const { container } = renderWidget('v7');
    await expectAppearance(container, 'pixel');
    expect(screen.getByRole('progressbar', { name: 'Playback progress' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByText('3:41')).toBeInTheDocument();
  });
});
