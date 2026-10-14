import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import type { UnavailabilityEvidence } from '@/lib/dataUnavailability';
import { DataSourceNotice, resolveDataSourceStatus, type DataSourceDescriptor, type DataSourceStatus } from './DataSourceNotice';

vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn(() => true),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

function source(
  id: string,
  label: string,
  query: DataSourceDescriptor['query'],
  enabled = true,
): DataSourceDescriptor {
  return { id, label, query, enabled };
}

describe('DataSourceNotice', () => {
  beforeEach(() => {
    vi.mocked(useOnlineStatus).mockReturnValue(true);
  });

  it.each([
    [{ isError: true }, 'failed'],
    [{ data: [], isError: true }, 'refreshFailed'],
    [{ data: [], fetchStatus: 'paused' }, 'paused'],
    [{ fetchStatus: 'paused', isPending: true }, 'paused'],
    [{ data: 0, isSuccess: true }, 'ready'],
    [{ data: [], isSuccess: true }, 'ready'],
    [{ data: null, isFetching: true }, 'refreshing'],
    [{ isPending: true, fetchStatus: 'fetching' }, 'loading'],
    [{}, 'pending'],
  ] satisfies [DataSourceDescriptor['query'], DataSourceStatus][])('preserves source distinctions for %j', (query, status) => {
    expect(resolveDataSourceStatus(source('test', 'Source', query))).toBe(status);
  });

  it('keeps retained paused refresh visible and independently retryable', () => {
    const pausedRefetch = vi.fn();
    const failedRefetch = vi.fn();
    const readyRefetch = vi.fn();
    const label = 'Retained source with a long label that must stay fully readable';
    render(
      <DataSourceNotice dir="rtl" data-testid="notice" sources={[
        source('paused', label, { data: [], fetchStatus: 'paused', refetch: pausedRefetch }),
        source('failed', 'Failed source', { isError: true, refetch: failedRefetch }),
        source('ready', 'Fresh source', { data: 0, refetch: readyRefetch }),
      ]} />,
    );
    expect(screen.getByTestId('notice')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(label)).not.toHaveClass('truncate');
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `Retry unavailable sources: ${label}` }));
    expect(pausedRefetch).toHaveBeenCalledTimes(1);
    expect(failedRefetch).not.toHaveBeenCalled();
    expect(readyRefetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(pausedRefetch).toHaveBeenCalledTimes(2);
    expect(failedRefetch).toHaveBeenCalledTimes(1);
  });

  it('marks a retained paused source as stale rather than healthy or fatal', () => {
    render(<DataSourceNotice sources={[
      source('paused', 'Retained source', { data: [], fetchStatus: 'paused' }),
    ]} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['online-paused', { fetchStatus: 'paused' }, 'unavailable'],
    ['cold-paused', { isPending: true, fetchStatus: 'paused' }, 'unavailable'],
    ['initial-loading-paused', { isLoading: true, fetchStatus: 'paused' }, 'unavailable'],
    ['refresh-paused', { data: [{ value: 12 }], fetchStatus: 'paused' }, 'stale'],
    ['zero-refresh-paused', { data: 0, fetchStatus: 'paused' }, 'stale'],
    ['empty-refresh-paused', { data: [], fetchStatus: 'paused' }, 'stale'],
    ['null-refresh-paused', { data: null, fetchStatus: 'paused' }, 'stale'],
  ] satisfies [string, DataSourceDescriptor['query'], 'unavailable' | 'stale'][])(
    'keeps %s badge and body cause-neutral without offline evidence',
    (_name, query, state) => {
      render(<DataSourceNotice data-testid="paused-notice" sources={[
        source('paused', 'Paused source', query),
      ]} />);

      const notice = screen.getByTestId('paused-notice');
      expect(notice).toHaveAttribute('data-data-state', state);
      expect(notice).not.toHaveAttribute('data-unavailable-reason');
      expect(notice).toHaveAttribute('role', state === 'stale' ? 'status' : 'alert');
      expect(notice).toHaveAttribute('aria-live', state === 'stale' ? 'polite' : 'assertive');
      expect(screen.getByText('Refresh paused')).toBeInTheDocument();
      expect(notice).not.toHaveTextContent(/offline|network|connectivity/i);
      expect(screen.getByText(state === 'stale'
        ? 'Previously loaded data remains visible while affected sources recover.'
        : 'No requested source has returned usable data yet.')).toBeInTheDocument();
    },
  );

  it.each([
    ['initial', undefined, 'unavailable'],
    ['retained', 0, 'stale'],
  ] as const)('preserves actual browser-offline indication for a %s pause', (_name, data, state) => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);
    const refetch = vi.fn();
    render(<DataSourceNotice sources={[
      source('paused', 'Paused source', { data, fetchStatus: 'paused', refetch }),
    ]} />);

    expect(screen.getByText('Paused offline')).toBeInTheDocument();
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.getByRole(state === 'stale' ? 'status' : 'alert'))
      .toHaveAttribute('data-data-state', state);
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Paused source' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ online: false }, 'Paused offline', undefined],
    [{ online: true }, 'Refresh paused', undefined],
    [{ vehicleState: 'offline' }, 'Paused offline', 'vehicle_offline'],
    [{ vehicleState: 'asleep' }, 'Refresh paused', 'vehicle_asleep'],
  ] satisfies [UnavailabilityEvidence, string, string | undefined][])(
    'uses independent caller evidence %j without inferring offline from pause',
    (evidence, label, reason) => {
      render(<DataSourceNotice evidence={evidence} sources={[
        source('paused', 'Retained source', { data: 0, fetchStatus: 'paused' }),
      ]} />);

      const notice = screen.getByRole('status');
      expect(notice).toHaveAttribute('data-data-state', 'stale');
      expect(screen.getByText(label)).toBeInTheDocument();
      if (reason) {
        expect(notice).toHaveAttribute('data-unavailable-reason', reason);
      } else {
        expect(notice).not.toHaveAttribute('data-unavailable-reason');
      }
      if (reason === 'vehicle_offline') {
        expect(notice).toHaveTextContent('The vehicle is not reachable');
      }
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('respects explicit online evidence over browser-offline state', () => {
    vi.mocked(useOnlineStatus).mockReturnValue(false);
    render(<DataSourceNotice evidence={{ online: true }} sources={[
      source('paused', 'Retained source', { data: 0, fetchStatus: 'paused' }),
    ]} />);

    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByText('Paused offline')).not.toBeInTheDocument();
  });

  it('retains the payload, snapshot, public copy and retry across pause recovery', () => {
    const payload = Object.freeze({ value: 0, observedAt: '2026-10-14T03:20:00Z' });
    const refetch = vi.fn();
    const query = Object.freeze({ data: payload, fetchStatus: 'paused' as const, refetch });
    const sources = [source('paused', 'Retained source', query)];
    const { rerender, container } = render(
      <DataSourceNotice
        sources={sources}
        title="Custom title"
        message="Retained snapshot is still visible"
        retryLabel="Try again"
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Custom title');
    expect(screen.getByText('Retained snapshot is still visible')).toBeInTheDocument();
    expect(query.data).toBe(payload);
    expect(query.data.value).toBe(0);
    expect(query.data.observedAt).toBe('2026-10-14T03:20:00Z');
    fireEvent.click(screen.getByRole('button', { name: 'Try again: Retained source' }));
    expect(refetch).toHaveBeenCalledTimes(1);

    rerender(<DataSourceNotice sources={[
      source('paused', 'Retained source', { ...query, fetchStatus: 'idle' }),
    ]} />);
    expect(container).toBeEmptyDOMElement();
    expect(query.data).toBe(payload);
  });

  it.each([
    [undefined, 'unavailable', 'alert'],
    [0, 'stale', 'status'],
  ] as const)('keeps service failures separate from pause with retained data %j', (data, state, role) => {
    render(<DataSourceNotice sources={[
      source('failed', 'Failed source', {
        data,
        isError: true,
        error: { name: 'ApiError', status: 503, message: 'Unavailable' },
      }),
      source('paused', 'Paused source', { data, fetchStatus: 'paused' }),
    ]} />);

    const notice = screen.getByRole(role);
    expect(notice).toHaveAttribute('data-data-state', state);
    expect(notice).toHaveAttribute('data-unavailable-reason', 'service_outage');
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByText('Paused offline')).not.toBeInTheDocument();
  });

  it('stays hidden when every enabled source is ready', () => {
    const { container } = render(
      <DataSourceNotice
        sources={[
          source('drives', 'Drive history', { data: [], isSuccess: true }),
          source('charging', 'Charging history', { data: [], isSuccess: true }),
        ]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden during a whole-page initial load', () => {
    const { container } = render(
      <DataSourceNotice
        sources={[
          source('drives', 'Drive history', {
            isLoading: true,
            isPending: true,
            isFetching: true,
            fetchStatus: 'fetching',
          }),
          source('charging', 'Charging history', {
            isLoading: true,
            isPending: true,
            isFetching: true,
            fetchStatus: 'fetching',
          }),
        ]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('identifies a failed source while preserving the ready source', () => {
    render(
      <DataSourceNotice
        sources={[
          source('drives', 'Drive history', { data: [{ id: 1 }], isSuccess: true }),
          source('charging', 'Charging history', {
            isError: true,
            error: new Error('offline'),
          }),
        ]}
      />,
    );

    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.getByText('Drive history')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Charging history')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('identifies a delayed source after another source has resolved', () => {
    render(
      <DataSourceNotice
        sources={[
          source('drives', 'Drive history', { data: [], isSuccess: true }),
          source('charging', 'Charging history', {
            isLoading: true,
            isFetching: true,
          }),
        ]}
      />,
    );

    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.getByText('Loading')).toBeInTheDocument();
  });

  it('distinguishes a failed background refresh from missing data', () => {
    render(
      <DataSourceNotice
        sources={[
          source('drives', 'Drive history', {
            data: [{ id: 1 }],
            isError: true,
            error: new Error('refresh failed'),
          }),
        ]}
      />,
    );

    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(screen.getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
  });

  it('uses an unavailable state when no source returned usable data', () => {
    render(
      <DataSourceNotice
        sources={[
          source('drives', 'Drive history', { isError: true }),
          source('charging', 'Charging history', {
            fetchStatus: 'paused',
            isPending: true,
          }),
        ]}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Service unavailable');
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
  });

  it('retries only unavailable sources and omits disabled prerequisites', () => {
    const readyRefetch = vi.fn();
    const failedRefetch = vi.fn();

    render(
      <DataSourceNotice
        sources={[
          source('drives', 'Drive history', {
            data: [],
            isSuccess: true,
            refetch: readyRefetch,
          }),
          source('charging', 'Charging history', {
            isError: true,
            refetch: failedRefetch,
          }),
          source('selection', 'Selected signal history', {}, false),
        ]}
      />,
    );

    expect(screen.queryByText('Selected signal history')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(failedRefetch).toHaveBeenCalledTimes(1);
    expect(readyRefetch).not.toHaveBeenCalled();
  });
});
