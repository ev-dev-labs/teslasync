import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { ComfortConsistencyMethodology } from './ComfortConsistencyMethodology';
import type { ComfortConsistencyQueryState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options?.[name] ?? '')),
  }),
}));

const ready: ComfortConsistencyQueryState = {
  vehicleSelected: true,
  isLoading: false,
  isResolved: true,
  error: null,
  refreshError: null,
  onRetry: vi.fn(),
};

const populated = summarizeComfortConsistency([
  {
    timestamp: '2026-08-08T12:00:00.000Z',
    insideTemp: 30,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower: true,
  },
  {
    timestamp: '2026-08-08T12:05:00.000Z',
    insideTemp: 21,
    driverTempSetting: 21,
    passengerTempSetting: 21,
    hvacPower: true,
  },
]);

const articleTitles = [
  'Source contract',
  'Ordered row gates',
  'Step intervals',
  'Stabilization windows',
  'Descriptive score',
  'Interpretation limits',
];

function expectStaticArticles() {
  const section = within(screen.getByTestId('comfort-consistency-methodology'));
  const articles = section.getAllByRole('article');
  expect(articles).toHaveLength(6);
  articleTitles.forEach((title, index) => {
    expect(within(articles[index]).getByRole('heading', { name: title }))
      .toBeInTheDocument();
    expect(articles[index].querySelector('p')).not.toBeEmptyDOMElement();
  });
}

describe('ComfortConsistencyMethodology', () => {
  it.each([
    ['no vehicle', { vehicleSelected: false }],
    ['loading', { isLoading: true, isResolved: false }],
    ['unresolved', { isResolved: false }],
    ['paused initial request', { isPaused: true, isResolved: false }],
    ['initial failure', { error: new Error('History unavailable'), isResolved: false }],
  ] satisfies [string, Partial<ComfortConsistencyQueryState>][])(
    'preserves six static articles without observational counts during %s',
    (_name, overrides) => {
      render(<ComfortConsistencyMethodology summary={populated} state={{ ...ready, ...overrides }} />);

      expectStaticArticles();
      expect(screen.queryByText(/returned rows, .*active samples/)).not.toBeInTheDocument();
    },
  );

  it.each([
    ['successful response', {}],
    ['refresh failure with retained data', { refreshError: new Error('Refresh failed') }],
    ['paused refresh with retained data', { isPaused: true }],
  ] satisfies [string, Partial<ComfortConsistencyQueryState>][])(
    'preserves populated observational counts for %s',
    (_name, overrides) => {
      render(<ComfortConsistencyMethodology summary={populated} state={{ ...ready, ...overrides }} />);

      expectStaticArticles();
      expect(screen.getByText(
        '2 returned rows, 2 active samples, and 1 outside-band fragments support only the disclosed observational summaries.',
      )).toBeInTheDocument();
    },
  );

  it('shows zero counts only once an empty response has resolved', () => {
    const summary = summarizeComfortConsistency([]);
    const { rerender } = render(
      <ComfortConsistencyMethodology summary={summary} state={{ ...ready, isResolved: false }} />,
    );
    expectStaticArticles();
    expect(screen.queryByText(/returned rows, .*active samples/)).not.toBeInTheDocument();

    rerender(<ComfortConsistencyMethodology summary={summary} state={ready} />);
    expectStaticArticles();
    expect(screen.getByText(
      '0 returned rows, 0 active samples, and 0 outside-band fragments support only the disclosed observational summaries.',
    )).toBeInTheDocument();
  });
});
