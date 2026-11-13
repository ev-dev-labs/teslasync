import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { RankedHypothesis } from '../lib/rootCauseIntelligence';
import { RootCauseHypothesisList } from './RootCauseHypothesisList';

const hypothesis: RankedHypothesis = {
  signal: 'LongUnmodifiedSignalIdentity', domains: ['battery'], relation: 'leads', lagMs: -60_000,
  shift: {
    splitMs: 1, before: { median: -1.5, mad: 0, count: 10 },
    after: { median: 0, mad: 0, count: 10 }, effectSize: 2, direction: 'up',
  },
  effectScore: 0.5, temporalScore: 0.5, coverageScore: 0.5, reliabilityScore: 0.5,
  score: 0.5, sampleCount: 20,
  rationale: 'Statistical association only — a lead worth reviewing, not a diagnosis or a claim of causal proof.',
};
const props = {
  hypotheses: [hypothesis, { ...hypothesis, signal: 'TiedRankSignal', relation: 'lags' as const }],
  hasChosenSignal: true, focalShiftFound: true, isLoading: false, isError: false,
};

describe('ranked hypothesis native records', () => {
  it.each(PACK_IDS)('%s owns each whole hypothesis rather than treating its statistical prose as a scalar rank', pack => {
    const original = JSON.stringify(props.hypotheses);
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <RootCauseHypothesisList {...props} />
    </div>, { wrapper: MemoryRouter });
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const records = screen.getAllByRole('listitem');
      expect(records).toHaveLength(2);
      records.forEach((record, index) => {
        expect(record).toHaveAttribute('data-surface-variant', 'standalone');
        expectAppDesignDataMode(record, APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
        for (const slot of ['record-body', 'record-title', 'record-context']) {
          expectAppDesignDataMode(record.querySelector(`[data-app-part~="${slot}"]`)!,
            APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
        }
        expect(record).toHaveTextContent(`#${index + 1}`);
        expect(record).toHaveTextContent(props.hypotheses[index].signal);
        expect(record).toHaveTextContent(hypothesis.rationale);
        expect(record).toHaveTextContent('-1.50 → 0.00');
        expect(record).toHaveTextContent('20 samples');
        expect(record).toHaveTextContent('Lag 1.00 min');
        expect(within(record).getByText(index === 0 ? 'leads' : 'lags')).toBeInTheDocument();
      });
      expect(container.querySelector('[data-app-list="ranked"], [role="meter"], [data-metric-fill]')).toBeNull();
      expect(JSON.stringify(props.hypotheses)).toBe(original);
    } finally { release(); }
  });

  it('retains the qualified-empty reason and source-local recovery without manufacturing a hypothesis', () => {
    const retry = vi.fn();
    const view = render(<RootCauseHypothesisList {...props} hypotheses={[]} focalHistoryAvailable={false} />, { wrapper: MemoryRouter });
    expect(screen.getByText('Not enough history yet for this signal and window.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).toBeNull();
    view.rerender(<RootCauseHypothesisList {...props} isError error={new Error('History failed')} onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(view.container.querySelector('[data-app-card-kind="record"]')).toBeNull();
  });
});
