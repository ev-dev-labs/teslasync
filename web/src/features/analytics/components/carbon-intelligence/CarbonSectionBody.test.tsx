import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonQueryState } from './types';

function state(overrides: Partial<CarbonQueryState> = {}): CarbonQueryState {
  return {
    enabled: true, hasData: true, isLoading: false, isResolved: true,
    isFetching: false, isPaused: false, refreshPaused: false,
    error: null, refreshError: null, onRetry: vi.fn(), ...overrides,
  };
}

function show(source: CarbonQueryState) {
  return render(
    <MemoryRouter>
      <CarbonSectionBody state={source} className="h-full">
        <p>Retained source measurement</p>
      </CarbonSectionBody>
    </MemoryRouter>,
  );
}

describe('CarbonSectionBody canonical source preservation', () => {
  it.each([
    [{ enabled: false, hasData: false, isResolved: false }, /Select a vehicle/],
    [{ hasData: false, isResolved: false }, /availability has not resolved/],
    [{ hasData: false, isPaused: true, isResolved: false }, /not treated as an empty response/],
  ] as const)('keeps the specialist prerequisite and unresolved copy', (overrides, message) => {
    show(state(overrides));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Retained source measurement')).not.toBeInTheDocument();
  });

  it('keeps the caller loading geometry and allocation class', () => {
    const { container } = show(state({ hasData: false, isLoading: true, isResolved: false }));
    expect(screen.getByRole('status', { name: 'Loading carbon evidence' })).toBeInTheDocument();
    expect(container.querySelector('.h-full')).toBeInTheDocument();
    expect(screen.queryByText('Retained source measurement')).not.toBeInTheDocument();
  });

  it('only an initial failure replaces children and retries the same source', () => {
    const retry = vi.fn();
    show(state({ hasData: false, isResolved: false, error: new Error('initial failure'), onRetry: retry }));
    expect(screen.getByText(/This source is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Retained source measurement')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each(['failure', 'paused', 'both'] as const)('keeps usable evidence during a %s refresh', (mode) => {
    const retry = vi.fn();
    const source = state({
      refreshError: mode !== 'paused' ? new Error('refresh failure') : null,
      refreshPaused: mode !== 'failure', onRetry: retry,
    });
    const before = { ...source };
    show(source);
    expect(screen.getByText('Retained source measurement')).toBeInTheDocument();
    expect(screen.getByText('Retained source measurement').parentElement).toHaveClass(
      'min-h-0', 'flex-1', 'flex-col',
    );
    expect(screen.getByText(mode === 'paused'
      ? 'The network is unavailable; cached evidence remains visible while refresh is paused.'
      : 'Refresh failed; the most recently loaded evidence remains visible.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(source).toEqual(before);
  });
});
