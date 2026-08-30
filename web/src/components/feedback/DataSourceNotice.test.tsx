import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { DataSourceNotice, type DataSourceDescriptor } from './DataSourceNotice';

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
    expect(screen.getByText('Paused offline')).toBeInTheDocument();
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
