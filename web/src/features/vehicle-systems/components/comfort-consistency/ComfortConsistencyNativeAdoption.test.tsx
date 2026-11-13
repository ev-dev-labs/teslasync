import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';

import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { formatDuration, formatTemperatureDelta, type UnitPref } from '@/lib/unitConversion';
import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { summarizeHvacCycling } from '../../lib/hvacCycling';
import type { PreconditioningComparison } from '../../lib/preconditioningEffectiveness';
import { HvacCyclingExactAccounting } from '../hvac-cycling/HvacCyclingExactAccounting';
import { HvacCyclingHourlyDuty } from '../hvac-cycling/HvacCyclingHourlyDuty';
import { HvacCyclingMethodology } from '../hvac-cycling/HvacCyclingMethodology';
import { HvacCyclingRunDirectory } from '../hvac-cycling/HvacCyclingRunDirectory';
import { HvacCyclingRunLengthDistribution } from '../hvac-cycling/HvacCyclingRunLengthDistribution';
import { HvacCyclingThresholdGateMatrix } from '../hvac-cycling/HvacCyclingThresholdGateMatrix';
import { HvacCyclingTransitionMatrix } from '../hvac-cycling/HvacCyclingTransitionMatrix';
import { PreconditioningComparisonCards } from '../preconditioning-effectiveness/PreconditioningComparisonCards';
import { ComfortConsistencyDeviationDistribution } from './ComfortConsistencyDeviationDistribution';
import { ComfortConsistencyExactAccounting } from './ComfortConsistencyExactAccounting';
import { ComfortConsistencyHourlyProfile } from './ComfortConsistencyHourlyProfile';
import { ComfortConsistencyMethodology } from './ComfortConsistencyMethodology';
import { ComfortConsistencyThresholdGateMatrix } from './ComfortConsistencyThresholdGateMatrix';
import { ComfortConsistencyWindowDirectory } from './ComfortConsistencyWindowDirectory';
import type { ComfortConsistencyQueryState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/components/charts', async () => ({
  ...(await import('@/test/chartTestDoubles')).chartTestDoubles,
  ...(await import('@/test/chartTestDoubles')).inertCartesianParts,
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const ready: ComfortConsistencyQueryState = {
  vehicleSelected: true, isLoading: false, isResolved: true,
  error: null, refreshError: null, onRetry: vi.fn(),
};
const prefs: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
  energy: 'kWh', duration: 'min', power: 'kW', precision: 1, locale: 'en-US',
};
const duration = (value: number | null | undefined) => formatDuration(value, prefs);
function deltaFormatter(temperature: UnitPref['temperature']) {
  return (value: number | null | undefined, options?: { precision?: number; signed?: boolean }) => {
    const formatted = formatTemperatureDelta(value, { ...prefs, temperature }, options);
    return options?.signed && value != null && Number.isFinite(value) && value > 0
      ? `+${formatted}` : formatted;
  };
}
const delta = deltaFormatter(prefs.temperature);
const rows = [false, true, true, true, false, true, true, true].map((on, index) => ({
  timestamp: new Date(Date.UTC(2026, 9, 14, 12, index * 2)).toISOString(),
  hvacPower: on,
  insideTemp: index === 1 || index === 5 ? 30 : 21,
  driverTempSetting: 21,
  passengerTempSetting: 21,
}));
const comfort = summarizeComfortConsistency(rows, { windowDisplayLimit: 1 });
const hvac = summarizeHvacCycling(rows, { runDisplayLimit: 2, timeZone: 'UTC' });
const comparison: PreconditioningComparison = {
  regime: 'all', conditionedCount: 3, unconditionedCount: 4,
  conditionedStartDeltaC: 0, unconditionedStartDeltaC: 2, startDeltaAdvantageC: 2,
  conditionedImprovementC: -1, unconditionedImprovementC: 1, improvementLiftC: -2,
  balanceCount: 3, volumeCount: 7, balanceConfidence: 0.5,
  volumeConfidence: 0.5, confidence: 0.25, evidence: 'limited',
};

function renderers(state = ready) {
  return (
    <>
      <ComfortConsistencyDeviationDistribution summary={comfort} state={state} formatDelta={delta} />
      <ComfortConsistencyExactAccounting summary={comfort} state={state} formatDuration={duration} />
      <ComfortConsistencyHourlyProfile summary={comfort} state={state} formatDuration={duration} />
      <ComfortConsistencyMethodology summary={comfort} state={state} />
      <ComfortConsistencyThresholdGateMatrix summary={comfort} state={state} formatDuration={duration} formatDelta={delta} />
      <ComfortConsistencyWindowDirectory summary={comfort} state={state} locale="en-US" formatDuration={duration} formatDelta={delta} />
      <HvacCyclingExactAccounting summary={hvac} state={state} />
      <HvacCyclingHourlyDuty summary={hvac} state={state} formatDuration={duration} />
      <HvacCyclingMethodology summary={hvac} />
      <HvacCyclingRunDirectory summary={hvac} state={state} locale="en-US" formatDuration={duration} />
      <HvacCyclingRunLengthDistribution summary={hvac} state={state} formatDuration={duration} />
      <HvacCyclingThresholdGateMatrix summary={hvac} state={state} formatDuration={duration} />
      <HvacCyclingTransitionMatrix summary={hvac} state={state} />
      <PreconditioningComparisonCards comparisons={[comparison]} metric="readiness" formatDelta={delta} />
    </>
  );
}

const dataRules: Rule[] = [];
postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => { dataRules.push(rule); });
const surfaceRules: Rule[] = [];
postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'))
  .walkRules(rule => { surfaceRules.push(rule); });
const identityRules = new Map(PACK_IDS.map(pack => {
  const rules: Rule[] = [];
  postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8'))
    .walkRules(rule => { rules.push(rule); });
  return [pack, rules] as const;
}));

const matchedNodes = new WeakMap<Element, Map<Rule, Set<Element>>>();
function matchingRules(host: Element, rules: readonly Rule[], node: Element, contract: string, owner?: string) {
  const matches = matchedNodes.get(host) ?? new Map<Rule, Set<Element>>();
  matchedNodes.set(host, matches);
  return rules.filter(rule => rule.selector.includes(contract)
    && (!owner || rule.selector.includes(`[data-app-design-owner~="${owner}"]`))
    && (() => {
      if (!matches.has(rule)) {
        matches.set(rule, new Set(rule.selectors.flatMap(selector => [...host.querySelectorAll(selector)])));
      }
      return matches.get(rule)!.has(node);
    })());
}

function tile(section: HTMLElement, label: string) {
  const found = within(section).getByText(label).closest('[data-app-metric="tile"]');
  if (!found) throw new Error(`Missing native tile for ${label}`);
  return found;
}

describe('vehicle-systems-01 native adoption', () => {
  it.each(PACK_IDS)('binds real records, readings and methodology surfaces to deliberate %s consumers', pack => {
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>{renderers()}</div>);
    const host = container.firstElementChild as HTMLElement;
    const release = observeAppDesignScopes(host);
    try {
      const owner = `data-${APPLICATION_DESIGNS[pack].data}`;
      const tiles = [...host.querySelectorAll('[data-app-metric="tile"]')];
      expect(tiles.length).toBeGreaterThan(70);
      for (const item of tiles) {
        const label = item.querySelector(':scope > [data-app-part="metric-label"]');
        const reading = item.querySelector(':scope > [data-app-part="metric-reading"]');
        const value = reading?.querySelector('[data-app-part="metric-value"]');
        expect(label).not.toBeNull();
        expect(value).not.toBeNull();
        expect(matchingRules(host, dataRules, item, '[data-app-metric="tile"]', owner).length).toBeGreaterThan(0);
        expect(matchingRules(host, dataRules, reading!, '[data-app-part~="metric-reading"]').length).toBeGreaterThan(0);
        expect(matchingRules(host, dataRules, label!, '[data-app-part~="metric-label"]').length).toBeGreaterThan(0);
        expect(matchingRules(host, dataRules, value!, '[data-app-part~="metric-value"]').length).toBeGreaterThan(0);
        if (!item.closest('[data-surface-variant="embedded"]')) {
          expect(matchingRules(host, identityRules.get(pack)!, value!, '[data-app-part~="metric-value"]', `pack-${pack}`).length).toBeGreaterThan(0);
        }
        const context = item.querySelector(':scope > [data-app-part="metric-context"]');
        if (context) {
          expect(matchingRules(host, dataRules, context, '[data-app-part~="metric-context"]').length).toBeGreaterThan(0);
        }
      }
      for (const bank of host.querySelectorAll('[data-app-part~="metric-grid"]')) {
        expect(matchingRules(host, dataRules, bank, '[data-app-part~="metric-grid"]', owner).length).toBeGreaterThan(0);
      }
      const records = [...host.querySelectorAll('[data-app-card-kind="record"]')];
      expect(records).toHaveLength(comfort.windowDirectory.displayed + hvac.runDirectory.displayed + 12);
      for (const record of records) {
        expect(record.querySelector('[data-app-part="record-header"]')).not.toBeNull();
        expect(record.querySelector('[data-app-part="record-title"]')).not.toBeNull();
        expect(record.querySelector('[data-app-part~="record-body"]')).not.toBeNull();
        expect(matchingRules(host, dataRules, record, '[data-app-card-kind="record"]', owner).length).toBeGreaterThan(0);
        for (const slot of ['record-header', 'record-body', 'record-title', 'record-context']) {
          const node = record.querySelector(`[data-app-part~="${slot}"]`);
          if (node) {
            expect(matchingRules(host, dataRules, node, `[data-app-part~="${slot}"]`, owner).length).toBeGreaterThan(0);
          }
        }
      }
      for (const row of host.querySelectorAll('[data-app-list="definitions"] > [data-app-part="list-row"]')) {
        expect(row.querySelector('dt[data-app-part="metric-label"]')).not.toBeNull();
        expect(row.querySelector('dd[data-app-part="metric-reading"]')).not.toBeNull();
        expect(matchingRules(host, dataRules, row, '[data-app-list="definitions"]', owner).length).toBeGreaterThan(0);
      }
      for (const id of ['comfort-consistency-methodology', 'hvac-cycling-methodology']) {
        const articles = within(screen.getByTestId(id)).getAllByRole('article');
        expect(articles).toHaveLength(6);
        for (const article of articles) {
          expect(matchingRules(host, surfaceRules, article, '[data-app-part~="card"]').length).toBeGreaterThan(0);
          expect(matchingRules(host, identityRules.get(pack)!, article, '[data-app-part~="card"]', `pack-${pack}`).length).toBeGreaterThan(0);
          expect(within(article).getByRole('heading')).not.toBeEmptyDOMElement();
        }
      }
    } finally { release(); }
  });

  it('uses the nearest complete profile without leaking native consumers into neutral previews or unselected surfaces', () => {
    const readings = <PreconditioningComparisonCards comparisons={[comparison]} metric="readiness" formatDelta={delta} />;
    const { container } = render(
      <>
        <div data-testid="unselected">{readings}</div>
        <div data-app-design-preview="" {...getAppDesignAttributes('v1')}>
          <div data-testid="outer">{readings}</div>
          <div data-app-design-preview="" data-testid="neutral">
            {readings}
            <div data-app-design-preview="" {...getAppDesignAttributes('v2')} data-testid="nested">
              {readings}
            </div>
          </div>
        </div>
      </>,
    );
    const release = observeAppDesignScopes(container);
    try {
      const outer = tile(screen.getByTestId('outer'), 'HVAC-active');
      const neutral = screen.getByTestId('neutral').querySelector('[data-app-metric="tile"]')!;
      const nested = tile(screen.getByTestId('nested'), 'HVAC-active');
      const unselected = tile(screen.getByTestId('unselected'), 'HVAC-active');
      expect(outer.getAttribute('data-app-design-owner')).toContain('data-instrument');
      expect(nested.getAttribute('data-app-design-owner')).toContain('data-cards');
      expect(matchingRules(container, dataRules, outer, '[data-app-metric="tile"]', 'data-instrument').length).toBeGreaterThan(0);
      expect(matchingRules(container, dataRules, nested, '[data-app-metric="tile"]', 'data-cards').length).toBeGreaterThan(0);
      expect(matchingRules(container, dataRules, nested, '[data-app-metric="tile"]', 'data-instrument')).toHaveLength(0);
      for (const node of [neutral, unselected]) {
        expect(node).not.toHaveAttribute('data-app-design-owner');
        expect(matchingRules(container, dataRules, node, '[data-app-metric="tile"]')).toHaveLength(0);
        expect(matchingRules(container, surfaceRules, node, '[data-app-part~="card"]')).toHaveLength(0);
      }
    } finally { release(); }
  });

  it('keeps ordered capped records, censoring, labels and formatted support through retained refresh', () => {
    const { rerender } = render(renderers());
    const windows = screen.getByTestId('comfort-consistency-window-directory');
    const runs = screen.getByTestId('hvac-cycling-run-directory');
    expect(within(windows).getByRole('list')).toHaveClass('max-h-[42rem]', 'overflow-y-auto');
    expect(within(windows).getAllByRole('listitem')).toHaveLength(1);
    expect(within(runs).getAllByRole('listitem')).toHaveLength(2);
    expect(windows).toHaveTextContent(`Showing 1 of ${comfort.windowDirectory.total} windows`);
    expect(windows).toHaveTextContent(`Chronological window ${comfort.windowDirectory.items[0].index}`);
    expect(runs).toHaveTextContent(`Chronological run ${hvac.runDirectory.items[0].index}`);
    expect(within(runs).getAllByText(/Censored/).length).toBeGreaterThan(0);
    const recordText = [...document.querySelectorAll('[data-app-card-kind="record"]')].map(node => node.textContent);
    rerender(renderers({ ...ready, refreshError: new Error('Refresh unavailable'), isPaused: true }));
    expect([...document.querySelectorAll('[data-app-card-kind="record"]')].map(node => node.textContent)).toEqual(recordText);
  });

  it('preserves all hourly buckets and distinguishes measured zero from missing share and quantiles', () => {
    render(renderers());
    const profile = screen.getByTestId('comfort-consistency-hourly-profile');
    expect(profile.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(24);
    expect(tile(profile, '00:00').querySelector('[data-app-part="metric-value"]')).toHaveTextContent('—');
    expect(tile(profile, '00:00').querySelector('[data-app-part="metric-context"]')).toHaveTextContent(duration(0));
    const duty = screen.getByTestId('hvac-cycling-hourly-duty');
    expect(duty.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(24);
    expect(tile(duty, '00:00').querySelector('[data-app-part="metric-value"]')).toHaveTextContent(duration(0));
    expect(tile(duty, '00:00').querySelector('[data-app-part="metric-context"]')).toHaveTextContent('0 starts');
    expect(tile(screen.getByTestId('hvac-cycling-transition-matrix'), 'Off → off')
      .querySelector('[data-app-part="metric-value"]')).toHaveTextContent('0');
    const summary = summarizeHvacCycling(rows.map(row => ({ ...row, hvacPower: true })));
    const view = render(<HvacCyclingRunLengthDistribution summary={summary} state={ready} formatDuration={duration} />);
    expect(tile(view.container, 'Off fragment median').querySelector('[data-app-part="metric-value"]')).toHaveTextContent('—');
  });

  it.each([
    ['no vehicle', { vehicleSelected: false }],
    ['loading', { isLoading: true, isResolved: false }],
    ['unresolved', { isResolved: false }],
    ['initial failure', { error: new Error('No source'), isResolved: false }],
  ])('does not publish gated native evidence during %s while retaining six explanations per method', (_name, overrides) => {
    render(renderers({ ...ready, ...overrides }));
    for (const id of ['comfort-consistency-methodology', 'hvac-cycling-methodology']) {
      expect(within(screen.getByTestId(id)).getAllByRole('article')).toHaveLength(6);
    }
    expect(within(screen.getByTestId('comfort-consistency-window-directory')).queryByRole('list')).toBeNull();
    expect(within(screen.getByTestId('hvac-cycling-run-directory')).queryByRole('list')).toBeNull();
    expect(screen.getByTestId('hvac-cycling-transition-matrix').querySelector('[data-app-metric="tile"]')).toBeNull();
  });

  it.each(['readiness', 'improvement'] as const)('preserves %s zero, signed/null values and withholding with Celsius and Fahrenheit formatters', metric => {
    for (const temperature of ['°C', '°F'] as const) {
      const display = deltaFormatter(temperature);
      const cases: PreconditioningComparison[] = [
        comparison,
        { ...comparison, regime: 'hot', evidence: 'none' },
        { ...comparison, regime: 'cold', conditionedStartDeltaC: null, conditionedImprovementC: null },
      ];
      const { container, unmount } = render(<PreconditioningComparisonCards comparisons={cases} metric={metric} formatDelta={display} />);
      const records = [...container.querySelectorAll<HTMLElement>('article')];
      expect(records.map(record => record.querySelector('[data-app-part="record-title"]')?.textContent))
        .toEqual(['Common-support pooled strata', 'Hot-start stratum', 'Cold-start stratum']);
      expect(records[0]).toHaveTextContent('3 active · 4 explicit-off control');
      expect(tile(records[0], 'HVAC-active').querySelector('[data-app-part="metric-value"]'))
        .toHaveTextContent(display(metric === 'readiness' ? 0 : -1));
      expect(tile(records[0], metric === 'readiness' ? 'Control minus active' : 'Active minus control')
        .querySelector('[data-app-part="metric-value"]')).toHaveTextContent(display(metric === 'readiness' ? 2 : -2, { signed: true }));
      expect([...records[1].querySelectorAll('[data-app-part="metric-value"]')].map(node => node.textContent))
        .toEqual(['—', '—', '—', '—']);
      expect(tile(records[2], 'HVAC-active').querySelector('[data-app-part="metric-value"]')).toHaveTextContent('—');
      expect(container.querySelector('[data-app-part="metric-unit"]')).toBeNull();
      unmount();
    }
  });
});
