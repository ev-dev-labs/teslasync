import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { summarizeArchetypes, type ArchetypeSummary } from '../../lib/driveArchetypes';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type { ArchetypeQueryState, ArchetypeSectionRequirement } from './types';

function state(overrides: Partial<ArchetypeQueryState> = {}): ArchetypeQueryState {
  return {
    vehicleSelected: true, hasData: true, isLoading: false, isResolved: true,
    isFetching: false, isPaused: false, refreshPaused: false,
    error: null, refreshError: null, onRetry: vi.fn(), ...overrides,
  };
}

function show(
  source: ArchetypeQueryState,
  requirement: ArchetypeSectionRequirement = 'resolved',
  summary: ArchetypeSummary = summarizeArchetypes([], { timeZone: 'UTC' }),
) {
  return render(
    <MemoryRouter>
      <ArchetypeSectionBody summary={summary} state={source} requirement={requirement} className="h-full">
        <p>Exact returned accounting</p>
      </ArchetypeSectionBody>
    </MemoryRouter>,
  );
}

describe('ArchetypeSectionBody canonical source preservation', () => {
  it('a valid empty response still renders resolved zero accounting', () => {
    show(state());
    expect(screen.getByText('Exact returned accounting')).toBeInTheDocument();
    expect(screen.queryByText(/required before clustering/)).not.toBeInTheDocument();
  });

  it.each([
    ['eligible', /No returned drive passed every/],
    ['clustered', /at least 20 are required before clustering/],
  ] as const)('retains the %s model publication gate without inventing a partition', (requirement, message) => {
    show(state(), requirement);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Exact returned accounting')).not.toBeInTheDocument();
  });

  it.each([
    ['insufficient_variation', /no standardized feature dimension varies/],
    ['insufficient_partition', /no candidate realized every requested cluster/],
  ] as const)('keeps the %s limitation', (status, message) => {
    const summary: ArchetypeSummary = { ...summarizeArchetypes([], { timeZone: 'UTC' }), status };
    show(state(), 'clustered', summary);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Exact returned accounting')).not.toBeInTheDocument();
  });

  it('keeps a missing directory distinct from insufficient input', () => {
    const summary: ArchetypeSummary = {
      ...summarizeArchetypes([], { timeZone: 'UTC' }), status: 'clustered',
    };
    show(state(), 'directory', summary);
    expect(screen.getByText(/No clustered assignment is available/)).toBeInTheDocument();
  });

  it.each([
    [{ vehicleSelected: false, hasData: false, isResolved: false }, /Select a vehicle/],
    [{ hasData: false, isResolved: false }, /availability has not resolved/],
    [{ hasData: false, isPaused: true, isResolved: false }, /no empty response is inferred/],
  ] as const)('preserves independent prerequisites and pending evidence', (overrides, message) => {
    show(state(overrides));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Exact returned accounting')).not.toBeInTheDocument();
  });

  it('keeps an accessible loading status with the allocated-height wrapper', () => {
    const { container } = show(state({ hasData: false, isLoading: true, isResolved: false }));
    expect(screen.getByRole('status', { name: 'Loading Drive archetypes' })).toBeInTheDocument();
    expect(container.querySelector('.h-full')).toBeInTheDocument();
  });

  it('only a fatal source replaces content and retries the existing callback', () => {
    const retry = vi.fn();
    show(state({ hasData: false, isResolved: false, error: new Error('unavailable'), onRetry: retry }));
    expect(screen.getByText(/Drive evidence is unavailable/)).toBeInTheDocument();
    expect(screen.queryByText('Exact returned accounting')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each(['failure', 'paused', 'both'] as const)('keeps complete content during a %s refresh', (mode) => {
    const retry = vi.fn();
    show(state({
      refreshError: mode !== 'paused' ? new Error('failed refresh') : null,
      refreshPaused: mode !== 'failure', onRetry: retry,
    }));
    expect(screen.getByText('Exact returned accounting')).toBeInTheDocument();
    expect(screen.getByText('Exact returned accounting').parentElement).toHaveClass(
      'min-h-0', 'flex-1', 'flex-col',
    );
    expect(screen.getByText(mode === 'paused'
      ? 'The network is unavailable, so cached evidence remains visible while its refresh is paused.'
      : 'The history window could not refresh. The most recently loaded evidence remains visible.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('a requirement-free explanation remains reachable even without a vehicle', () => {
    show(state({ vehicleSelected: false, hasData: false, isResolved: false }), 'none');
    expect(screen.getByText('Exact returned accounting')).toBeInTheDocument();
  });
});
