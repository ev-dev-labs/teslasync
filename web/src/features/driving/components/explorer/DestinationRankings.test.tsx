import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode, matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { summarizeExplorer, type Destination } from '../../lib/explorer';
import { DestinationRankings } from './DestinationRankings';
import { DiscoveryCadenceSummary } from './DiscoveryCadenceSummary';
import { ExclusionAccounting } from './ExclusionAccounting';
import { ExplorerMethodology } from './ExplorerMethodology';
import { NewRepeatBehavior } from './NewRepeatBehavior';

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null, vehicleId: 1 }),
}));

const ready = { isLoading: false, error: null, onRetry: vi.fn() };
const empty = summarizeExplorer([]);
const destinations: Destination[] = [1, 2].map(ordinal => ({
  id: `place-${ordinal}`, ordinal, label: ordinal === 1 ? 'A very long destination label' : null,
  visits: ordinal, repeatVisits: ordinal - 1, distanceFromBaseM: ordinal * 1000,
  firstVisitedAt: '2026-08-01T10:00:00Z', lastVisitedAt: '2026-08-02T10:00:00Z', firstVisitMonth: '2026-08',
}));
const populated = {
  ...empty,
  farthestRanking: [...destinations].reverse(),
  rareRanking: destinations,
  evidence: { ...empty.evidence, rankingSufficient: true },
  repeatBehavior: { destinationArrivals: 3, newArrivals: 2, repeatArrivals: 1, newShare: 2 / 3, repeatShare: 1 / 3 },
};
const formatDistance = (value: number | null) => value == null ? '—' : `${value} m`;
const surfaceRules: Rule[] = [];
postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'))
  .walkRules(rule => { surfaceRules.push(rule); });

describe('explorer native adoption', () => {
  it('preserves mixed exclusive counts and supported cadence with unmeasured intervals', () => {
    const { container } = render(<>
      <ExclusionAccounting exclusions={{
        missingTimestamp: 1, invalidTimestamp: 2, missingCoordinates: 0,
        invalidCoordinates: 3, outOfRangeCoordinates: 4,
      }} />
      <DiscoveryCadenceSummary summary={{
        ...empty, evidence: { ...empty.evidence, cadenceSufficient: true },
        cadence: { ...empty.cadence, discoveries: 3 },
      }} />
    </>);
    expect([...container.querySelectorAll('dd')].map(node => node.textContent)).toEqual(['1', '2', '0', '3', '4']);
    const brief = screen.getByRole('region', { name: 'Observed discovery intervals' });
    expect(within(brief).getByText('Median gap')).toBeInTheDocument();
    expect(within(brief).queryByText('0 days')).not.toBeInTheDocument();
    expect(brief.querySelector('[data-operational-brief-surface="standalone"]')).toBeInTheDocument();
  });

  it.each(PACK_IDS)('%s composes true ranking, definitions, threshold operands and explanatory notice', pack => {
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)} dir="rtl">
        <DestinationRankings summary={populated} state={ready} formatDistance={formatDistance} />
        <ExplorerMethodology summary={populated} state={ready} />
        <ExclusionAccounting exclusions={empty.eligibility.exclusions} />
        <DiscoveryCadenceSummary summary={populated} />
        <NewRepeatBehavior summary={populated} state={ready} />
      </div>,
    );
    const host = container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const lists = host.querySelectorAll('[data-app-list="ranked"]');
      expect(lists).toHaveLength(2);
      const farthest = within(lists[0] as HTMLElement).getAllByRole('listitem');
      const rare = within(lists[1] as HTMLElement).getAllByRole('listitem');
      expect(farthest[0]).toHaveTextContent('Unnamed destination 2');
      expect(rare[0]).toHaveTextContent('A very long destination label');
      expectAppDesignDataMode(farthest[0], APPLICATION_DESIGNS[pack].data, '[data-app-list="ranked"]');
      expect(farthest[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('1');
      expect(farthest[0].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent(/^1$/);
      expect(farthest[0].querySelector('[data-app-part~="metric-context"]')).toHaveTextContent('2000 m · 2 arrivals');
      const definitions = host.querySelector('[data-app-list="definitions"]')!;
      expect(definitions.tagName).toBe('DL');
      expect(definitions.querySelectorAll('dt')).toHaveLength(5);
      expect([...definitions.querySelectorAll('dd')].map(node => node.textContent)).toEqual(['0', '0', '0', '0', '0']);
      expectAppDesignDataMode(definitions.querySelector('[data-app-part~="list-row"]')!, APPLICATION_DESIGNS[pack].data, '[data-app-list="definitions"]');
      const tiles = screen.getByTestId('explorer-methodology').querySelectorAll('[data-app-metric="tile"]');
      expect(tiles).toHaveLength(3);
      expectAppDesignDataMode(tiles[0], APPLICATION_DESIGNS[pack].data, '[data-app-metric="tile"]');
      expect(tiles[0].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('0/3');
      expect(screen.getByText('Three destination discoveries are required before interval cadence is reported.').closest('[data-app-part="card"]')).not.toBeNull();
      const cards = host.querySelectorAll('[data-app-part="card"][data-surface-variant="standalone"]');
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        expect(surfaceRules.some(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === 'border-radius')
          && rule.selectors.some(selector => card.matches(selector)))).toBe(true);
      }
      const notice = screen.getByTestId('explorer-new-repeat').querySelector('[data-app-feedback-kind="notice"]')!;
      expect(notice.querySelector('[data-app-part~="feedback-icon"] svg')).toHaveAttribute('aria-hidden', 'true');
      expect(notice.querySelector('[data-app-part~="feedback-content"]')).toHaveTextContent('first chronological arrival');
      expect(notice.querySelector('[data-app-part~="feedback-content"] > [data-app-part~="feedback-message"]'))
        .toHaveTextContent('first chronological arrival');
      expect(matchesAppDesignCss(notice, `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`)
        .some(match => match.declarations.display === 'grid')).toBe(true);
    } finally {
      release();
    }
  });

  it('preserves insufficient evidence and the independent empty rare-ranking state', () => {
    const { container, rerender } = render(<DestinationRankings summary={empty} state={ready} formatDistance={formatDistance} />);
    expect(container.querySelector('[data-app-list="ranked"]')).toBeNull();
    expect(screen.getByText(/A repeated inferred base and at least two destinations/)).toBeInTheDocument();
    rerender(<DestinationRankings summary={{ ...populated, rareRanking: [] }} state={ready} formatDistance={formatDistance} />);
    expect(container.querySelectorAll('[data-app-list="ranked"]')).toHaveLength(1);
    expect(screen.getByText('Every ranked destination has more than two arrivals.')).toBeInTheDocument();
  });

  it('preserves measured zero cadence, the standalone brief and the zero-arrival behavior gate', () => {
    const supported = {
      ...empty, evidence: { ...empty.evidence, cadenceSufficient: true },
      cadence: { ...empty.cadence, discoveries: 3, medianGapDays: 0, longestGapDays: 1, latestGapDays: 0 },
    };
    const snapshot = JSON.stringify(supported);
    const { container } = render(<>
      <DiscoveryCadenceSummary summary={supported} />
      <NewRepeatBehavior summary={empty} state={ready} />
    </>);
    const brief = screen.getByRole('region', { name: 'Observed discovery intervals' });
    expect(within(brief).getAllByText('0 days')).toHaveLength(2);
    expect(within(brief).getByText('1 days')).toBeInTheDocument();
    expect(brief.querySelector('[data-operational-brief-surface="standalone"]')).toBeInTheDocument();
    expect(screen.getByText('No non-base destination arrivals are available to classify as new or repeat.')).toBeInTheDocument();
    expect(screen.getByTestId('explorer-new-repeat').querySelector('[data-app-feedback-kind="notice"]')).toBeNull();
    expect(container.querySelectorAll('[data-app-part="card"]')).toHaveLength(1);
    expect(JSON.stringify(supported)).toBe(snapshot);
  });
});
