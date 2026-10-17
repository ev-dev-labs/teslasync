import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import { SourceRecovery } from './SourceRecovery';

describe('SourceRecovery', () => {
  it('leaves active initial loading to the source content', () => {
    const state = deriveDataState({
      isPending: true, isLoading: true, isFetching: true, fetchStatus: 'fetching', refetch: vi.fn(),
    });
    const { container } = render(<SourceRecovery state={state} label="Drain events" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains a paused initial request without claiming an empty result or connectivity cause', () => {
    const retry = vi.fn();
    const state = deriveDataState({ isPending: true, fetchStatus: 'paused', refetch: retry });
    render(<SourceRecovery state={state} label="Drain events" />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(within(notice).getByText('Source paused')).toBeInTheDocument();
    expect(within(notice).getByText('This source is paused. No measurements have been received yet.')).toBeInTheDocument();
    expect(notice).not.toHaveTextContent(/offline|failed|previously loaded|no events|zero/i);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Drain events' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each([[], 0])('does not label a successful empty or zero payload as paused', data => {
    const state = deriveDataState({ data, isSuccess: true, fetchStatus: 'idle' });
    const { container } = render(<SourceRecovery state={state} label="Drain events" />);
    expect(state.hasData).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it('retains refresh warnings and retries only the affected source, then clears on recovery', () => {
    const retryEvents = vi.fn();
    const retryStats = vi.fn();
    const data = [{ drain_pct: 0 }];
    const failed = deriveDataState({ data, error: new Error('Refresh failed'), refetch: retryEvents });
    const healthy = deriveDataState({ data: 0, refetch: retryStats });
    const { rerender } = render(<>
      <SourceRecovery state={failed} label="Drain events" />
      <SourceRecovery state={healthy} label="Drain statistics" />
    </>);

    expect(failed.data).toBe(data);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
    expect(screen.queryByText('Source paused')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Drain events' }));
    expect(retryEvents).toHaveBeenCalledTimes(1);
    expect(retryStats).not.toHaveBeenCalled();

    rerender(<SourceRecovery
      state={deriveDataState({ data, error: new Error('Refresh failed'), isFetching: true, refetch: retryEvents })}
      label="Drain events"
    />);
    expect(screen.getByRole('button', { name: 'Retry Drain events' })).toBeDisabled();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();

    rerender(<SourceRecovery
      state={deriveDataState({ data, isSuccess: true, refetch: retryEvents })}
      label="Drain events"
    />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('keeps the retained paused warning rather than the no-measurements explanation', () => {
    const state = deriveDataState({ data: 0, fetchStatus: 'paused', refetch: vi.fn() });
    render(<SourceRecovery state={state} label="Drain statistics" />);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.queryByText('This source is paused. No measurements have been received yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Drain statistics' })).toBeEnabled();
  });

  it('preserves the initial failure explanation when a failed request is paused', () => {
    const state = deriveDataState({ error: new Error('Request failed'), fetchStatus: 'paused', refetch: vi.fn() });
    render(<MemoryRouter><SourceRecovery state={state} label="Drain events" /></MemoryRouter>);
    expect(screen.getByText('Drain events could not be loaded. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText('Source paused')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Drain events' })).toBeEnabled();
  });
});
