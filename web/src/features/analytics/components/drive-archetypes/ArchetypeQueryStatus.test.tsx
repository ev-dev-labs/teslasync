import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { summarizeArchetypes } from '../../lib/driveArchetypes';
import { ArchetypeQueryStatus } from './ArchetypeQueryStatus';
import type { ArchetypeQueryState } from './types';

const summary = summarizeArchetypes([], { timeZone: 'UTC' });

function state(overrides: Partial<ArchetypeQueryState> = {}): ArchetypeQueryState {
  return {
    vehicleSelected: true,
    hasData: true,
    isLoading: false,
    isResolved: true,
    isFetching: false,
    isPaused: false,
    refreshPaused: false,
    error: null,
    refreshError: null,
    onRetry: vi.fn(),
    ...overrides,
  };
}

describe('ArchetypeQueryStatus recovery', () => {
  it('announces active loading without inferring an empty response', () => {
    render(<ArchetypeQueryStatus summary={summary} state={state({
      hasData: false, isResolved: false, isLoading: true, isFetching: true,
    })} />);

    expect(screen.getByRole('status', {
      name: 'Loading drive-archetype evidence',
    })).toBeInTheDocument();
    expect(screen.queryByText(/valid empty response/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps paused-without-data distinct from loading and successful zero', () => {
    render(<ArchetypeQueryStatus summary={summary} state={state({
      hasData: false, isResolved: false, isPaused: true,
    })} />);

    expect(screen.getByText(/no empty response has been inferred/)).toBeInTheDocument();
    expect(screen.queryByRole('status', {
      name: 'Loading drive-archetype evidence',
    })).not.toBeInTheDocument();
    expect(screen.queryByText(/valid empty response/)).not.toBeInTheDocument();
  });

  it('reports successful empty evidence rather than a loading or clustering failure', () => {
    render(<ArchetypeQueryStatus summary={summary} state={state()} />);

    expect(summary.source.returnedRows).toBe(0);
    expect(summary.analyzedDrives).toBe(0);
    expect(screen.getByText(/valid empty response/)).toBeInTheDocument();
    expect(screen.queryByText(/required for clustering/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('retries a fatal query failure through the existing callback', () => {
    const onRetry = vi.fn();
    render(<ArchetypeQueryStatus summary={summary} state={state({
      hasData: false, isResolved: false, error: new Error('unavailable'), onRetry,
    })} />);

    expect(screen.getByText('Drive-history query failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText(/valid empty response/)).not.toBeInTheDocument();
  });

  it('retains refresh-failure context, prevents duplicate pending retries, and recovers', () => {
    const onRetry = vi.fn();
    const failed = state({ refreshError: new Error('refresh unavailable'), onRetry });
    const { rerender } = render(
      <ArchetypeQueryStatus summary={summary} state={failed} />,
    );

    expect(screen.getByText(/most recently loaded evidence remains visible/)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry refresh' });
    expect(retry).toHaveClass(
      'bg-[var(--control-bg)]', 'min-h-11', 'min-w-11', 'md:min-h-9',
      'whitespace-normal',
    );
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(<ArchetypeQueryStatus summary={summary} state={{
      ...failed, isFetching: true,
    }} />);
    expect(screen.getByText(/most recently loaded evidence remains visible/)).toBeInTheDocument();
    expect(retry).toBeDisabled();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(<ArchetypeQueryStatus summary={summary} state={state({ onRetry })} />);
    expect(screen.queryByText(/could not refresh/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry refresh' })).not.toBeInTheDocument();
    expect(screen.getByText(/valid empty response/)).toBeInTheDocument();
  });

  it('keeps a paused retained refresh distinct from an empty response', () => {
    render(<ArchetypeQueryStatus summary={summary} state={state({
      refreshPaused: true,
    })} />);

    expect(screen.getByText(/cached evidence remains visible/)).toBeInTheDocument();
    expect(screen.queryByText(/valid empty response/)).not.toBeInTheDocument();
  });
});
