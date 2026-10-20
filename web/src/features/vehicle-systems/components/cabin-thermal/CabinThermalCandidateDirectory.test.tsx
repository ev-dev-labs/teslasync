import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { summarizeCabinThermal } from '../../lib/cabinThermal';
import { CabinThermalCandidateDirectory } from './CabinThermalCandidateDirectory';
import type { CabinThermalQueryState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name])),
  }),
}));

vi.mock('@/components/layout', () => ({
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) => (
    <div><h2>{title}</h2>{children}</div>
  ),
}));

vi.mock('@/components/ui', () => ({
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));

vi.mock('@/components/feedback', () => ({
  Skeleton: () => <div data-testid="loading-skeleton" />,
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtInt: (value: number) => String(value) }),
}));

vi.mock('./CabinThermalCandidateRow', () => ({
  CabinThermalCandidateRow: () => <li>Candidate evidence</li>,
}));

afterEach(cleanup);

const empty = summarizeCabinThermal([]);
const nonempty = summarizeCabinThermal(Array.from({ length: 12 }, (_, index) => ({
  timestamp: new Date(Date.UTC(2026, 5, 1, 12, index * 10)).toISOString(),
  insideTemp: 20 + 20 * Math.exp(-index * 10 / 90),
  outsideTemp: 20,
  isAcOn: false,
  hvacPower: false,
})));

const ready: CabinThermalQueryState = {
  vehicleSelected: true,
  isLoading: false,
  isResolved: true,
  error: null,
  refreshError: null,
  onRetry: vi.fn(),
};

function directory(summary = empty, state = ready) {
  return <CabinThermalCandidateDirectory
    summary={summary}
    state={state}
    locale="en-US"
    temperatureUnit="°C"
    formatTemperature={value => String(value)}
    formatDuration={value => String(value)}
  />;
}

function expectShell() {
  expect(screen.getByText('Candidate-window directory')).toBeInTheDocument();
  expect(screen.getByText(
    'Newest first, with inputs, derivable fit values, and one final disposition per candidate.',
  )).toBeInTheDocument();
}

describe('CabinThermalCandidateDirectory population trust', () => {
  it.each([
    ['active loading', { isResolved: false, isLoading: true }],
    ['paused without data', { isResolved: false, isPaused: true }],
    ['unresolved idle', { isResolved: false }],
    ['initial failure', { isResolved: false, error: new Error('Unavailable') }],
    ['error despite resolution flag', { error: new Error('Unavailable') }],
    ['no vehicle', { vehicleSelected: false }],
  ])('keeps static explanation without population claims during %s', (_name, overrides) => {
    render(directory(nonempty, { ...ready, ...overrides }));
    expectShell();
    expect(screen.queryByText(/^Showing /)).not.toBeInTheDocument();
    expect(screen.getAllByText('Climate-history availability has not resolved.').length)
      .toBeGreaterThan(0);
    expect(screen.queryByText('Candidate evidence')).not.toBeInTheDocument();
  });

  it('reports a successful empty result as actual zero counts', () => {
    render(directory());
    expectShell();
    expect(screen.getByText(
      `Showing 0 of 0 candidates; 0 omitted by the ${empty.candidateDirectory.cap}-window display cap.`,
    )).toBeInTheDocument();
    expect(screen.getByText('No climate rows were returned for this vehicle.')).toBeInTheDocument();
  });

  it.each([['empty', empty], ['nonempty', nonempty]])(
    'preserves real %s counts through refresh failure, pause and recovery',
    (_name, summary) => {
      const { rerender } = render(directory(summary));
      const counts = summary.candidateDirectory;
      const notice = `Showing ${counts.displayed} of ${counts.total} candidates; ${counts.omitted} omitted by the ${counts.cap}-window display cap.`;
      expect(screen.getByText(notice)).toBeInTheDocument();
      for (const overrides of [
        { refreshError: new Error('Refresh failed') },
        { isPaused: true },
        {},
      ]) {
        rerender(directory(summary, { ...ready, ...overrides }));
        expectShell();
        expect(screen.getByText(notice)).toBeInTheDocument();
        expect(screen.queryAllByText('Candidate evidence')).toHaveLength(counts.displayed);
      }
    },
  );
});
