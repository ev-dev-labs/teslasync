import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display';
import { CardGrid } from '@/components/layout';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { VehicleOperationalBrief } from './VehicleOperationalBrief';
import { deriveDataState } from '@/api/dataState';
import type { MediaSnapshot } from '@/api/types';
import { MediaStats } from '../media-player-modernization/MediaStats';
import { MediaSlot } from '../media-player-modernization/MediaSlot';
import { playbackProgress } from '../media-player-modernization/mediaPresentation';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: 'km', speed: 'km/h', energy: 'kWh', power: 'kW', temperature: '°C',
    pressure: 'bar', duration: 'h', precision: 2, locale: 'en-US',
  } }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '€' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));

const period = {
  kind: 'unknown' as const,
  label: 'Returned climate rows',
  reason: 'Seven-day climate source and independently limited drive history; not complete coverage.',
};

describe('real vehicle OperationalBrief and numeric bridge', () => {
  it('preserves the media slot fallback and public CardGrid placement without adding a panel', () => {
    const content = <div data-testid="media-content">Recorded track</div>;
    const view = render(<MediaSlot>{content}</MediaSlot>);
    const fallback = view.container.querySelector('[data-media-slot]');
    expect(fallback).toHaveAttribute('data-card-size', 'full');
    expect(fallback).toHaveAttribute('data-card-resolved-span', '1');
    expect(fallback).toHaveClass('min-w-0', '[&>div]:h-full', 'col-span-1');
    expect(screen.getByTestId('media-content').parentElement).toBe(fallback);

    view.rerender(<CardGrid label="Media placement" items={[
      { id: 'track', size: 'half', content: <MediaSlot>{content}</MediaSlot> },
    ]} />);
    const placed = view.container.querySelector('[data-media-slot]');
    expect(placed).toHaveAttribute('data-card-size', 'half');
    expect(placed).toHaveAttribute('data-card-resolved-span', '1');
    expect(placed).toHaveClass('min-w-0', '[&>div]:h-full', 'col-span-1');
    expect(screen.getByTestId('media-content').parentElement).toBe(placed);
    expect(placed?.parentElement).toHaveClass('grid');
  });

  it.each([
    [250, 125, 0.25, 0.125, 50],
    [1499, 749, 1.499, 0.749, 749 / 1499 * 100],
    [250, -125, 0.25, 0, 0],
    [250, 500, 0.25, 0.25, 100],
    [185000, 65000, 185, 65, 65000 / 185000 * 100],
  ])('retains source milliseconds (%s, %s) independently of determinate ARIA seconds', (duration, elapsed, durationSec, elapsedSec, percent) => {
    const source: MediaSnapshot = {
      id: 1, vehicle_id: 7, created_at: '2026-06-10T10:00:00Z',
      now_playing_duration: duration, now_playing_elapsed: elapsed,
    };
    expect(playbackProgress(source)).toEqual({ durationSec, elapsedSec, percent });
    expect(source.now_playing_duration).toBe(duration);
    expect(source.now_playing_elapsed).toBe(elapsed);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.MIN_VALUE])(
    'withholds determinate playback when duration %s cannot provide positive ARIA seconds',
    duration => {
      expect(playbackProgress({
        id: 1, vehicle_id: 7, created_at: '2026-06-10T10:00:00Z',
        now_playing_duration: duration, now_playing_elapsed: 0,
      })).toBeNull();
    },
  );

  it('retains raw pressure, seconds, source audio levels, signs, zero, and withheld values', () => {
    const sourceFormatter = vi.fn((raw: number) => ({ value: `source:${raw}`, unit: '' }));
    const metrics: readonly StatMetric[] = [
      { metricId: 'pressure', occurrenceId: 'pressure', label: 'Pressure', rawValue: 280 },
      { metricId: 'duration', occurrenceId: 'seconds', label: 'Seconds', rawValue: 120, display: { formatter: sourceFormatter } },
      { metricId: 'number', occurrenceId: 'volume', label: 'Audio level', rawValue: 0, display: { formatter: sourceFormatter } },
      { metricId: 'number', occurrenceId: 'delta', label: 'Signed delta', rawValue: -1.25, display: { formatter: sourceFormatter } },
      { metricId: 'count', occurrenceId: 'unknown', label: 'Unknown count', rawValue: null, missingReason: 'Independent source unavailable' },
      { metricId: 'number', occurrenceId: 'invalid', label: 'Invalid scalar', rawValue: Number.NaN, display: { formatter: sourceFormatter } },
    ];
    const hook = renderHook(() => useOperationalMetrics(metrics));
    expect(hook.result.current.map(metric => metric.rawValue)).toEqual([280, 120, 0, -1.25, null, Number.NaN]);
    expect(hook.result.current.map(metric => metric.valueState)).toEqual(['value', 'value', 'value', 'value', 'missing', 'invalid']);
    const view = render(<MemoryRouter><VehicleOperationalBrief id="vehicle-brief" title="Climate evidence"
      metrics={metrics} period={period} /></MemoryRouter>);
    const brief = view.container.querySelector('[data-operational-brief]');
    expect(brief).toBeInTheDocument();
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief?.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(brief?.querySelector('[data-operational-metric="pressure"] [data-operational-value]')).toHaveTextContent('2.80 bar');
    expect(brief?.querySelector('[data-operational-metric="volume"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief?.querySelector('[data-operational-metric="volume"] [data-operational-value]')).toHaveTextContent('source:0');
    expect(brief?.querySelector('[data-operational-metric="unknown"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief?.querySelector('[data-operational-metric="invalid"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(sourceFormatter.mock.calls.map(call => call[0])).not.toContainEqual(Number.NaN);
    expect(metrics[0].rawValue).toBe(280);
  });

  it('keeps mixed-source reasons and rich links inside the real drawer and restores the trigger', async () => {
    const metrics: StatMetric[] = [{
      metricId: 'count', occurrenceId: 'rows', label: 'Returned rows', rawValue: 0,
      description: 'Counts are not a monitoring assurance.',
      context: <a href="/fsd">Retained source drill-through</a>,
      comparisonContent: <span>Original denominator: 9 tracked settings</span>,
    }];
    const view = render(<MemoryRouter><VehicleOperationalBrief id="vehicle-brief" title="Safety evidence"
      metrics={metrics} period={period} retained footer={<span>Independent source retry remains available</span>} /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
    expect(view.container.querySelector('[data-source-retained]')).toHaveAttribute('data-source-retained', 'true');
    const trigger = screen.getByRole('button', { name: 'Review details' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Safety evidence details' });
    expect(within(dialog).getByText('Counts are not a monitoring assurance.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Retained source drill-through' })).toHaveAttribute('href', '/fsd');
    expect(within(dialog).getByText('Original denominator: 9 tracked settings')).toBeInTheDocument();
    expect(within(dialog).getAllByText(period.reason).length).toBeGreaterThan(0);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByText('Independent source retry remains available')).toBeInTheDocument();
  });

  it('shows busy source shells without blanking retained readings on a later refresh', () => {
    const metrics: StatMetric[] = [{ metricId: 'count', occurrenceId: 'rows', label: 'Rows', rawValue: null }];
    const view = render(<VehicleOperationalBrief id="busy" title="Evidence" metrics={metrics} period={period} loading />);
    expect(view.container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(view.container.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    view.rerender(<VehicleOperationalBrief id="busy" title="Evidence"
      metrics={[{ ...metrics[0], rawValue: 0 }]} period={period} retained />);
    expect(view.container.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(view.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
  });

  it('describes partial media history independently of latest readings and successful read times', () => {
    const row: MediaSnapshot = {
      id: 1, vehicle_id: 7, created_at: '2026-06-10T10:00:00Z',
      now_playing_title: 'Recorded track', playback_source: 'Spotify', audio_volume: 0,
    };
    const latest = { ...row, audio_volume_increment: 0 };
    const readAt = Date.parse('2026-10-14T21:00:00Z');
    const view = render(<MediaStats filtered={[row]} history={[row]} latest={latest}
      hasVehicle historyLoading={false} mediaLoading={false} historyError={null} mediaError={null}
      historySource={deriveDataState({ data: [row], dataUpdatedAt: readAt }, { provenance: 'historical', partial: true })}
      mediaSource={deriveDataState({ data: latest, dataUpdatedAt: readAt })}
      start="2026-06-01" end="2026-07-01" />);
    for (const id of ['media-unique-tracks', 'media-top-source', 'media-average-volume']) {
      const metric = view.container.querySelector(`[data-operational-metric="${id}"]`);
      expect(metric).toHaveTextContent('Partial evidence');
      expect(metric).toHaveTextContent('Returned history: 2026-06-01 – 2026-07-01');
      expect(metric).not.toHaveTextContent('Latest media snapshot');
    }
    const step = view.container.querySelector('[data-operational-metric="media-volume-step"]');
    expect(step).toHaveTextContent('Latest media snapshot');
    expect(step).not.toHaveTextContent('Partial evidence');
    expect(step?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(view.container.querySelector('[data-operational-metric="media-average-volume"] [data-operational-value]'))
      .toHaveTextContent('0');
    expect(screen.getByText('Not a live-state observation')).toBeInTheDocument();
    expect(view.container.querySelector('time')).not.toBeInTheDocument();
    expect(view.container).not.toHaveTextContent(/Up to date|Fresh|2026-10-14/);
  });

  it('qualifies retained latest media only, without marking returned history as retained', () => {
    const row: MediaSnapshot = {
      id: 1, vehicle_id: 7, created_at: '2026-06-10T10:00:00Z',
      now_playing_title: 'Recorded track', playback_source: 'Spotify', audio_volume: 6,
      audio_volume_increment: 0.5,
    };
    const view = render(<MediaStats filtered={[row]} history={[row]} latest={row}
      hasVehicle historyLoading={false} mediaLoading={false} historyError={null} mediaError={null}
      mediaSource={deriveDataState({ data: row, fetchStatus: 'paused' })}
      start="2026-06-01" end="2026-07-01" />);
    expect(view.container.querySelector('[data-operational-metric="media-volume-step"]'))
      .toHaveTextContent('Retained evidence');
    for (const id of ['media-unique-tracks', 'media-top-source', 'media-average-volume']) {
      expect(view.container.querySelector(`[data-operational-metric="${id}"]`))
        .not.toHaveTextContent('Retained evidence');
    }
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
  });

  it('wires initial loading and fatal summary states, then recovers to successful empty and zero evidence', () => {
    const props = {
      filtered: [], history: undefined, latest: null, hasVehicle: true,
      historyLoading: true, mediaLoading: true, historyError: null, mediaError: null,
      start: '2026-06-01', end: '2026-07-01',
    };
    const view = render(<MediaStats {...props} />);
    const brief = () => view.container.querySelector('[data-operational-brief]');
    expect(brief()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading source')).toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(view.container.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog').querySelector('[data-operational-value]')).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    view.rerender(<MediaStats {...props} historyLoading={false} mediaLoading={false}
      historyError={new Error('History failed')} mediaError={new Error('Latest failed')} />);
    expect(brief()).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Source unavailable')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This source is unavailable');

    const zero: MediaSnapshot = { id: 1, vehicle_id: 7, created_at: props.start, audio_volume_increment: 0 };
    view.rerender(<MediaStats {...props} historyLoading={false} mediaLoading={false}
      history={[]} latest={zero} />);
    expect(brief()).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Returned evidence')).toBeInTheDocument();
    for (const id of ['media-unique-tracks', 'media-volume-step']) {
      expect(view.container.querySelector(`[data-operational-metric="${id}"] [data-operational-value]`))
        .toHaveTextContent('0');
    }
    for (const id of ['media-top-source', 'media-average-volume']) {
      expect(view.container.querySelector(`[data-operational-metric="${id}"]`))
        .toHaveAttribute('data-value-state', 'missing');
    }
  });

  it.each([false, true])('does not mark paused initial sources busy (isLoading=%s)', isLoading => {
    const view = render(<MediaStats filtered={[]} history={undefined} latest={null}
      hasVehicle historyLoading={isLoading} mediaLoading={isLoading} historyError={null} mediaError={null}
      historySource={deriveDataState<readonly MediaSnapshot[]>({ fetchStatus: 'paused' })}
      mediaSource={deriveDataState<MediaSnapshot>({ fetchStatus: 'paused' })}
      start="2026-06-01" end="2026-07-01" />);
    expect(view.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Evidence unresolved')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(view.container).not.toHaveTextContent('Loading this source');
    expect(view.container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
  });

  it('keeps disabled no-vehicle sources unresolved instead of loading or fatal', () => {
    const view = render(<MediaStats filtered={[]} history={undefined} latest={null}
      hasVehicle={false} historyLoading mediaLoading
      historyError={new Error('Disabled history')} mediaError={new Error('Disabled latest')}
      start="2026-06-01" end="2026-07-01" />);
    expect(view.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Evidence unresolved')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
  });

  it.each(['history', 'latest'] as const)('keeps independent %s metrics through initial loading, failure, retained refresh and recovery', source => {
    const row: MediaSnapshot = {
      id: 1, vehicle_id: 7, created_at: '2026-06-10T10:00:00Z',
      now_playing_title: 'Recorded track', playback_source: 'Spotify',
      audio_volume: 0, audio_volume_increment: 0,
    };
    const props = {
      filtered: source === 'history' ? [row] : [],
      history: source === 'history' ? [row] : undefined,
      latest: source === 'latest' ? row : null,
      hasVehicle: true, historyLoading: source !== 'history', mediaLoading: source !== 'latest',
      historyError: null, mediaError: null, start: '2026-06-01', end: '2026-07-01',
    };
    const view = render(<MediaStats {...props} />);
    const id = source === 'history' ? 'media-average-volume' : 'media-volume-step';
    const value = () => view.container.querySelector(`[data-operational-metric="${id}"] [data-operational-value]`);
    expect(view.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(value()).toHaveTextContent('0');

    const error = new Error('Refresh failed');
    view.rerender(<MediaStats {...props} historyLoading={false} mediaLoading={false}
      historyError={source === 'latest' ? error : null} mediaError={source === 'history' ? error : null} />);
    expect(value()).toHaveTextContent('0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    view.rerender(<MediaStats {...props} historyLoading mediaLoading
      historyError={error} mediaError={error} />);
    expect(value()).toHaveTextContent('0');
    expect(view.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    view.rerender(<MediaStats {...props} historyLoading={false} mediaLoading={false} history={[row]} latest={row} filtered={[row]} />);
    expect(value()).toHaveTextContent('0');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Returned evidence')).toBeInTheDocument();
    expect(view.container.querySelector('[data-source-retained]')).not.toBeInTheDocument();
  });
});
