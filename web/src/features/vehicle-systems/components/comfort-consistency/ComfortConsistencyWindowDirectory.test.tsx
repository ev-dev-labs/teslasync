import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { ComfortConsistencyWindowDirectory } from './ComfortConsistencyWindowDirectory';
import type { ComfortConsistencyQueryState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
        String(values?.[name] ?? ''),
      ),
  }),
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: (value: number) => String(value) }),
}));

afterEach(cleanup);

const BASE = Date.parse('2026-08-08T12:00:00.000Z');
const state: ComfortConsistencyQueryState = {
  vehicleSelected: true,
  isLoading: false,
  isResolved: true,
  error: null,
  refreshError: null,
  onRetry: vi.fn(),
};
const empty = summarizeComfortConsistency([]);
const evidence = summarizeComfortConsistency(
  [0, 1, 2].map((minute) => ({
    timestamp: new Date(BASE + minute * 60_000).toISOString(),
    insideTemp: 30,
    driverTempSetting: 21,
    hvacPower: true,
  })),
);

function directory(
  summary = empty,
  overrides: Partial<ComfortConsistencyQueryState> = {},
) {
  return (
    <ComfortConsistencyWindowDirectory
      summary={summary}
      state={{ ...state, ...overrides }}
      locale="en-US"
      formatDuration={(value) => value == null ? '—' : `${value} s`}
      formatDelta={(value) => value == null ? '—' : `${value} C`}
    />
  );
}

function expectShell() {
  expect(screen.getByText('Stabilization-window directory')).toBeInTheDocument();
  expect(screen.getByText(/Newest first; each outside-band fragment/)).toBeInTheDocument();
}

describe('ComfortConsistencyWindowDirectory availability', () => {
  it.each([
    ['active loading', { isLoading: true, isResolved: false }],
    ['paused without data', { isPaused: true, isResolved: false }],
    ['initial failure', { isResolved: false, error: new Error('Unavailable') }],
    ['no selected vehicle', { vehicleSelected: false }],
  ])('keeps the shell and cap without observed counts during %s', (_, overrides) => {
    render(directory(empty, overrides));

    expectShell();
    expect(screen.getByText(
      `Showing — of — windows; — omitted by the ${empty.windowDirectory.cap}-window display cap.`,
    )).toBeInTheDocument();
    expect(screen.queryByText(/Showing 0 of 0 windows/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No unique valid timestamp/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    if ('isPaused' in overrides) {
      expect(screen.getByText('Climate-history availability has not resolved.')).toBeInTheDocument();
    }
  });

  it('reports actual zero counts only after a successful empty response', () => {
    const { rerender } = render(directory(empty, { isResolved: false }));
    expect(screen.getByText('Climate-history availability has not resolved.')).toBeInTheDocument();

    rerender(directory());

    expectShell();
    expect(screen.getByText(
      `Showing 0 of 0 windows; 0 omitted by the ${empty.windowDirectory.cap}-window display cap.`,
    )).toBeInTheDocument();
    expect(screen.getByText(
      'No unique valid timestamp is available for chronological analysis.',
    )).toBeInTheDocument();
    expect(screen.queryByText('Climate-history availability has not resolved.')).not.toBeInTheDocument();
  });

  it('distinguishes analyzed in-band evidence with zero windows from pending', () => {
    const inBand = summarizeComfortConsistency([{
      timestamp: new Date(BASE).toISOString(),
      insideTemp: 21,
      driverTempSetting: 21,
      hvacPower: true,
    }]);
    render(directory(inBand));

    expect(screen.getByText(/Showing 0 of 0 windows; 0 omitted/)).toBeInTheDocument();
    expect(screen.getByText(
      'Active fragments exist, but none began outside the configured comfort band.',
    )).toBeInTheDocument();
  });

  it('retains counts and window details through refresh failure, pause, and recovery', () => {
    const { rerender } = render(directory(evidence));
    expect(screen.getByText(/Showing 1 of 1 windows; 0 omitted/)).toBeInTheDocument();
    const contents = screen.getByRole('list').textContent;

    rerender(directory(evidence, { refreshError: new Error('Refresh failed') }));
    expect(screen.getByRole('list').textContent).toBe(contents);
    expect(screen.getByText(/Showing 1 of 1 windows; 0 omitted/)).toBeInTheDocument();

    rerender(directory(evidence, { isPaused: true }));
    expect(screen.getByRole('list').textContent).toBe(contents);

    rerender(directory());
    expect(screen.getByText(/Showing 0 of 0 windows; 0 omitted/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    rerender(directory(evidence));
    expect(screen.getByRole('list').textContent).toBe(contents);
  });
});
