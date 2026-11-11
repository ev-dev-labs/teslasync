import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';

import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { analyzeTrueCost } from '../../lib/trueCost';
import { TrueCostAccountingIdentities } from './TrueCostAccountingIdentities';
import { TrueCostBoundaryDisclosure } from './TrueCostBoundaryDisclosure';
import { TrueCostBreakEven } from './TrueCostBreakEven';
import { TrueCostMethodology } from './TrueCostMethodology';
import { TrueCostQueryStatus } from './TrueCostQueryStatus';
import type { TrueCostDisplay, TrueCostQueryState, TrueCostSectionProps } from './types';

function rules(name: string) {
  const result: Rule[] = [];
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', name), 'utf8'))
    .walkRules(rule => { result.push(rule); });
  return result;
}
const baseRules = rules('base.css');
const feedbackRules = rules('feedback.css');
function consumes(node: Element, sheet: readonly Rule[], contract: string, property: string) {
  return sheet.some(rule => rule.nodes.some(item => item.type === 'decl' && item.prop === property)
    && rule.selectors.some(selector => selector.includes(contract) && node.matches(selector)));
}

const source = {
  vehicle_id: 7, total_charging_cost: 100, total_wh: 100_000, total_sessions: 8,
  total_km: 1000, first_date: '2025-01-01', last_date: '2025-10-01',
  equivalent_gas_cost: 300, total_savings: 200, monthly_savings: 20,
  cost_per_km_ev: 0.1, maintenance_savings_estimate: 490, months_of_ownership: 10,
  gas_price: 4, gas_efficiency_mpg: 30,
  monthly_breakdown: [{
    month: '2025-01', ev_cost: 100, equiv_gas_cost: 300, energy_wh: 100_000,
    savings: 200, cumulative_savings: 200,
  }],
};
const ready: TrueCostQueryState = {
  enabled: true, hasData: true, isLoading: false, isResolved: true, isFetching: false,
  isPaused: false, refreshPaused: false, error: null, refreshError: null, onRetry: vi.fn(),
};
const number = (value: number | null | undefined) => value == null ? '—' : value.toFixed(3);
const display: TrueCostDisplay = {
  distanceUnit: 'km', energyUnit: 'Wh', formatNumber: number,
  formatCurrency: value => value == null ? '—' : `€${number(value)}`,
  formatSignedCurrency: value => value == null ? '—' : `€${number(value)}`,
  formatDistanceKm: value => `${number(value)} km`, distanceValueKm: value => value,
  costPerDistanceValue: value => value, formatCostPerDistance: number,
  formatEnergy: value => `${number(value)} Wh`, energyValue: value => value,
  formatMonth: value => value,
};
const props: TrueCostSectionProps = {
  analysis: analyzeTrueCost(source), state: ready, display, gasUnit: 'gallon',
};
function Surfaces() {
  return <>
    <TrueCostBoundaryDisclosure {...props} />
    <TrueCostBreakEven {...props} />
    <TrueCostAccountingIdentities {...props} />
    <TrueCostMethodology {...props} />
    <TrueCostQueryStatus analysis={props.analysis} state={{ ...ready, hasData: false, isLoading: true }} />
  </>;
}
function mount(children: ReactNode) {
  return render(children, { wrapper: MemoryRouter });
}

describe('analytics-late-01 true-cost ownership (source-only)', () => {
  it.each(PACK_IDS)('%s binds actual record bodies, thresholds and loading copy to compatible consumers', pack => {
    const original = JSON.stringify({ source, analysis: props.analysis });
    const { container } = mount(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}><Surfaces /></div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const design = APPLICATION_DESIGNS[pack];
      const boundary = screen.getByTestId('tco-boundary');
      const identities = screen.getByTestId('tco-accounting');
      const methodology = screen.getByTestId('tco-methodology');
      const cards = [
        ...boundary.querySelectorAll('[data-app-card-kind="record"]'),
        ...identities.querySelectorAll('li'),
        ...methodology.querySelectorAll('li'),
      ];
      expect(cards).toHaveLength(2 + 8 + 8);
      for (const card of cards) {
        expect(card).toHaveAttribute('data-surface-variant', 'standalone');
        expect(consumes(card, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
        expect(consumes(card, feedbackRules, `[data-app-data="${design.data}"]`, 'display')).toBe(true);
        const body = card.querySelector(':scope > [data-app-part~="record-body"]')!;
        expect(body).not.toBeEmptyDOMElement();
        expect(consumes(body, feedbackRules, '[data-app-card-kind="record"]', 'max-inline-size')).toBe(true);
      }
      for (const table of within(identities).getAllByRole('table')) {
        expect(table).toHaveAttribute('data-app-part', 'table');
        expect(within(table).getAllByRole('row')).toHaveLength(4);
        expect(within(table).getAllByRole('rowheader').map(cell => cell.textContent))
          .toEqual(['Expected', 'Observed', 'Residual', 'Tolerance']);
      }
      const fuel = within(identities).getByRole('table', { name: 'Gas total − EV total vs API fuel delta' });
      expect(within(fuel).getAllByText('€200.000')).toHaveLength(2);
      expect(within(fuel).getByText('€0.000')).toBeInTheDocument();
      expect(within(fuel).getByText('€0.020')).toBeInTheDocument();
      expect(within(identities).getByText('Outside tolerance')).toBeInTheDocument();
      expect(within(identities).getAllByText('Unavailable').length).toBeGreaterThan(0);
      expect(boundary).toHaveTextContent('not a complete ownership-cost calculation');
      expect(boundary).toHaveTextContent('Purchase price, depreciation, resale, insurance, registration, financing, taxes, and actual service records.');
      const limits = within(methodology).getAllByRole('listitem');
      limits.forEach((row, index) => expect(row).toHaveTextContent(`${index + 1}.`));
      for (const caveat of ['different filter and temporal scope', 'no timezone metadata', 'not measured service spend',
        'not forecasts or recommendations', 'Negative deltas are valid modeled losses']) {
        expect(methodology).toHaveTextContent(caveat);
      }
      const tiles = screen.getByTestId('tco-break-even').querySelectorAll('[data-app-metric="tile"]');
      expect(tiles).toHaveLength(2);
      for (const tile of tiles) {
        expect(consumes(tile, feedbackRules, `[data-app-data="${design.data}"]`, 'padding')).toBe(true);
        expect(tile.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
        expect(tile.querySelector('[data-app-part~="metric-context"]')).not.toBeEmptyDOMElement();
        expect(consumes(tile.querySelector('[data-app-part~="metric-reading"]')!,
          feedbackRules, '[data-app-part~="metric-value"]', 'font-variant-numeric')).toBe(true);
      }
      expect(tiles[0]).toHaveTextContent('€1.333/gal');
      expect(tiles[1]).toHaveTextContent('90.000 MPG');
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      const loading = screen.getByRole('status', { name: 'Loading true cost evidence' });
      expect(consumes(loading, feedbackRules, `[data-app-feedback="${design.feedback}"]`, 'display')).toBe(true);
      expect(consumes(loading, feedbackRules, `[data-app-feedback="${design.feedback}"]`, 'padding')).toBe(true);
      expect(loading.querySelector('[data-app-part~="feedback-icon"]')).toHaveAttribute('aria-hidden', 'true');
      expect(loading.querySelector('[data-app-part~="feedback-content"] > [data-app-part~="feedback-message"]'))
        .toHaveTextContent('Loading recorded-cost charging and positive-drive evidence...');
      expect(loading).not.toHaveAttribute('data-app-tone', 'success');
      expect(JSON.stringify({ source, analysis: props.analysis })).toBe(original);
    } finally { release(); }
  });

  it('retains a valid zero gasoline threshold, the configured fuel unit, and unavailable MPG', () => {
    const analysis = analyzeTrueCost({ ...source, total_charging_cost: 0 });
    mount(<TrueCostBreakEven {...props} analysis={analysis} gasUnit="liter" />);
    const tiles = screen.getByTestId('tco-break-even').querySelectorAll('[data-app-metric="tile"]');
    expect(tiles).toHaveLength(2);
    expect(tiles[0].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('€0.000/L');
    expect(tiles[0]).not.toHaveAttribute('data-app-state', 'missing');
    expect(tiles[1].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('—');
    expect(tiles[1]).toHaveAttribute('data-app-state', 'missing');
  });

  it('keeps unconditional boundaries and all eight limits when evidence is malformed or absent', () => {
    const analysis = analyzeTrueCost({ total_sessions: 0, total_km: 0, monthly_breakdown: 'invalid' });
    mount(<>
      <TrueCostBoundaryDisclosure {...props} analysis={analysis} state={{ ...ready, enabled: false }} />
      <TrueCostMethodology {...props} analysis={analysis} />
      <TrueCostBreakEven {...props} analysis={analysis} />
    </>);
    expect(screen.getByTestId('tco-boundary').querySelectorAll('[data-app-card-kind="record"]')).toHaveLength(2);
    expect(screen.getByText(/synthetic one-month maintenance floor is withheld/)).toBeInTheDocument();
    expect(within(screen.getByTestId('tco-methodology')).getAllByRole('listitem')).toHaveLength(8);
    expect(screen.getByText('The monthly_breakdown field is malformed; no monthly rows were fabricated.')).toBeInTheDocument();
    expect(screen.getByText('Positive recorded spend, distance, gas baseline, price, and MPG are required.')).toBeInTheDocument();
  });

  it.each([
    [{ enabled: false, isLoading: true }, 'Select a vehicle to query its operating-cost envelope.'],
    [{ isPaused: true }, 'Initial loading is paused while the network is unavailable; no empty response is inferred.'],
    [{ refreshPaused: true }, 'Cached evidence remains visible while its refresh is paused.'],
    [{ refreshError: new Error('Refresh failed') }, 'The refresh failed; the most recently loaded evidence remains visible.'],
    [{ isFetching: true }, 'Cached evidence is visible while a refresh is in progress.'],
    [{}, 'This workspace compares recorded-cost charging with a modeled gasoline equivalent; it is not a complete ownership-cost account.'],
  ] satisfies Array<[Partial<TrueCostQueryState>, string]>)('does not turn a distinct query branch into initial loading: %s', (overrides, message) => {
    mount(<TrueCostQueryStatus analysis={props.analysis} state={{ ...ready, ...overrides }} />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading true cost evidence' })).not.toBeInTheDocument();
    if (overrides.refreshError) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
      expect(ready.onRetry).toHaveBeenCalledOnce();
    }
  });

  it('retains fatal recovery, resolved zero and malformed-payload notices as separate states', () => {
    const retry = vi.fn();
    const view = mount(<TrueCostQueryStatus analysis={props.analysis} state={{ ...ready, error: new Error('Unavailable'), onRetry: retry }} />);
    expect(screen.getByText('Operating-cost query failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<TrueCostQueryStatus analysis={analyzeTrueCost({ total_sessions: 0, total_km: 0 })} state={ready} />);
    expect(screen.getByText(/valid zero envelope/)).toBeInTheDocument();
    view.rerender(<TrueCostQueryStatus analysis={analyzeTrueCost(undefined)} state={ready} />);
    expect(screen.getByText(/top-level payload is missing or malformed/)).toBeInTheDocument();
  });

  it('leaves unselected/widget-only trees neutral and resolves nested profiles at actual targets', () => {
    const { container } = mount(<div>
      <div data-testid="unselected"><Surfaces /></div>
      <div data-app-design-preview="" {...getAppDesignAttributes('v2')}>
        <div data-app-design-preview="" data-testid="widget-only"><Surfaces /></div>
        <div data-app-design-preview="" {...getAppDesignAttributes('terminal')} data-testid="nested"><Surfaces /></div>
      </div>
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      for (const id of ['unselected', 'widget-only']) {
        expect(screen.getByTestId(id).querySelector('[data-app-design-owner]')).toBeNull();
      }
      const tile = screen.getByTestId('nested').querySelector('[data-app-metric="tile"]')!;
      expect(consumes(tile, feedbackRules, '[data-app-data="ledger"]', 'padding')).toBe(true);
      expect(consumes(tile, feedbackRules, '[data-app-data="cards"]', 'padding')).toBe(false);
    } finally { release(); }
  });
});
