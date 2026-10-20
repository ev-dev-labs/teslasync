import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import { ClimateSourceBoundary } from './ClimateSourceBoundary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: { label?: string }) =>
      fallback.replace('{{label}}', options?.label ?? ''),
    i18n: { language: 'en' },
  }),
}));

interface Readings {
  temperature: number | null;
  history: number[];
}

function boundary(source: DataStateSource<Readings>) {
  return (
    <>
      <ClimateSourceBoundary state={deriveDataState(source)} label="Climate">
        <p>Climate controls remain mounted</p>
        <p>Temperature: {source.data?.temperature ?? 'unknown'}</p>
        <p>History rows: {source.data?.history.length ?? 'unknown'}</p>
      </ClimateSourceBoundary>
      <ClimateSourceBoundary
        state={deriveDataState({ data: { temperature: 20, history: [20] } })}
        label="Charging"
      >
        <p>Charging remains usable</p>
      </ClimateSourceBoundary>
    </>
  );
}

describe('ClimateSourceBoundary', () => {
  it('announces active initial loading without gating controls or independent sources', () => {
    render(boundary({ isPending: true, isFetching: true, fetchStatus: 'fetching' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading Climate');
    expect(screen.getByText('Climate controls remain mounted')).toBeInTheDocument();
    expect(screen.getByText('Temperature: unknown')).toBeInTheDocument();
    expect(screen.getByText('Charging remains usable')).toBeInTheDocument();
    expect(screen.queryByText(/Showing retained measurements/)).not.toBeInTheDocument();
  });

  it('distinguishes paused initial loading from empty or retained data and recovers', () => {
    const view = render(boundary({ isPending: true, fetchStatus: 'paused' }));
    expect(screen.getByRole('status')).toHaveTextContent('Refresh paused · Climate');
    expect(screen.getByRole('status')).not.toHaveTextContent(/offline|retained|Loading/);
    expect(screen.getByText('History rows: unknown')).toBeInTheDocument();
    expect(screen.getByText('Charging remains usable')).toBeInTheDocument();
    view.rerender(boundary({ isPending: true, isFetching: true, fetchStatus: 'fetching' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading Climate');
    view.rerender(boundary({ data: { temperature: 0, history: [] }, isSuccess: true }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Temperature: 0')).toBeInTheDocument();
    expect(screen.getByText('History rows: 0')).toBeInTheDocument();
  });

  it.each(['refresh failure', 'paused refresh'] as const)(
    'retains successful empty history and measured zero during %s, then clears the notice',
    mode => {
      const retry = vi.fn();
      const data = { temperature: 0, history: [] };
      const view = render(boundary({
        data, refetch: retry,
        ...(mode === 'refresh failure'
          ? { isError: true, error: new Error('Climate refresh failed') }
          : { fetchStatus: 'paused' as const }),
      }), { wrapper: MemoryRouter });
      expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
      expect(screen.getByRole('status')).toHaveTextContent(
        mode === 'refresh failure' ? 'Climate refresh failed' : 'Refresh paused',
      );
      expect(screen.getByText('Temperature: 0')).toBeInTheDocument();
      expect(screen.getByText('History rows: 0')).toBeInTheDocument();
      expect(screen.getByText('Charging remains usable')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(retry).toHaveBeenCalledTimes(1);
      view.rerender(boundary({ data, isSuccess: true }));
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
      expect(screen.getByText('Temperature: 0')).toBeInTheDocument();
    },
  );

  it('replaces only the fatal source, retries it, and restores its body on recovery', () => {
    const retry = vi.fn();
    const view = render(boundary({
      isError: true, error: new Error('Climate unavailable'), refetch: retry,
    }), { wrapper: MemoryRouter });
    expect(screen.queryByText('Climate controls remain mounted')).not.toBeInTheDocument();
    expect(screen.getByText('Charging remains usable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(boundary({ data: { temperature: 21, history: [21] }, isSuccess: true }));
    expect(screen.getByText('Climate controls remain mounted')).toBeInTheDocument();
    expect(screen.getByText('Temperature: 21')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });
});
