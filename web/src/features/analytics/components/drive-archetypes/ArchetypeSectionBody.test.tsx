import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Drive } from '@/types/driving';
import { summarizeArchetypes, type ArchetypeSummary } from '../../lib/driveArchetypes';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type { ArchetypeQueryState, ArchetypeSectionRequirement } from './types';

function eligibleDrives(count: number, varied = false): Drive[] {
  return Array.from({ length: count }, (_, index) => {
    const distanceM = varied && index % 2 === 1 ? 140_000 : 12_000;
    return {
      id: index + 1, vehicleId: 1, startTs: '2026-03-02T08:00:00Z', endTs: null,
      durationS: 1_200, distanceM, energyUsedWh: distanceM * 0.18,
      avgSpeedMps: varied && index % 2 === 1 ? 28 : 8,
      outsideTempAvgC: 15, startAddress: null, endAddress: null,
      startLat: null, startLon: null, endLat: null, endLon: null,
      startBatteryPct: null, endBatteryPct: null, regenEnergyWh: null,
      maxSpeedMps: null, avgPowerW: null, insideTempAvgC: null,
      score: null, endedStatus: null, createdAt: '', updatedAt: '',
    };
  });
}

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

  it.each([
    [1, 'insufficient_drives'],
    [20, 'insufficient_variation'],
  ] as const)('renders eligible-only evidence for %i constant-feature drives despite %s', (count, status) => {
    const summary = summarizeArchetypes(eligibleDrives(count), { timeZone: 'UTC' });
    expect(summary.analyzedDrives).toBe(count);
    expect(summary.status).toBe(status);
    show(state(), 'eligible', summary);
    expect(screen.getByText('Exact returned accounting')).toBeInTheDocument();
    expect(screen.queryByText(/required before clustering|no standardized feature dimension varies/)).not.toBeInTheDocument();
  });

  it.each(['clustered', 'directory'] as const)('still withholds %s evidence below the floor and for constant features', (requirement) => {
    const { unmount } = show(
      state(), requirement, summarizeArchetypes(eligibleDrives(1), { timeZone: 'UTC' }),
    );
    expect(screen.getByText(/at least 20 are required before clustering/)).toBeInTheDocument();
    expect(screen.queryByText('Exact returned accounting')).not.toBeInTheDocument();
    unmount();
    show(state(), requirement, summarizeArchetypes(eligibleDrives(20), { timeZone: 'UTC' }));
    expect(screen.getByText(/no standardized feature dimension varies/)).toBeInTheDocument();
    expect(screen.queryByText('Exact returned accounting')).not.toBeInTheDocument();
  });

  it('renders eligible-only evidence even when a varied input cannot realize a partition', () => {
    const summary = summarizeArchetypes(eligibleDrives(20, true), {
      timeZone: 'UTC', minK: 3, maxK: 3,
    });
    expect(summary.status).toBe('insufficient_partition');
    expect(summary.analyzedDrives).toBe(20);
    show(state(), 'eligible', summary);
    expect(screen.getByText('Exact returned accounting')).toBeInTheDocument();
  });

  it.each(['resolved', 'eligible', 'clustered', 'directory'] as const)('preserves populated %s content', (requirement) => {
    const summary = summarizeArchetypes(eligibleDrives(20, true), { timeZone: 'UTC' });
    expect(summary.status).toBe('clustered');
    expect(summary.directory.items.length).toBeGreaterThan(0);
    show(state(), requirement, summary);
    expect(screen.getByText('Exact returned accounting')).toBeInTheDocument();
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
