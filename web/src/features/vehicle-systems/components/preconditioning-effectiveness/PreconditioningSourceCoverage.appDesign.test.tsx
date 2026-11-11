import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types';
import { formatDateTime } from '@/lib/dateFormat';
import { formatDuration, formatTemperatureDelta, type UnitPref } from '@/lib/unitConversion';
import type { Drive } from '@/types/driving';
import {
  summarizePreconditioningEffectiveness,
  type DepartureDirectoryItem,
  type DepartureDisposition,
  type PreconditioningClimateSample,
} from '../../lib/preconditioningEffectiveness';
import { PreconditioningDataAvailability } from './PreconditioningDataAvailability';
import { PreconditioningDepartureCard } from './PreconditioningDepartureCard';
import { PreconditioningExactAccounting } from './PreconditioningExactAccounting';
import { PreconditioningHourlyProfile } from './PreconditioningHourlyProfile';
import { PreconditioningMethodology } from './PreconditioningMethodology';
import { PreconditioningSourceCoverage } from './PreconditioningSourceCoverage';
import { PreconditioningStrata } from './PreconditioningStrata';
import { PreconditioningThresholdConfidence } from './PreconditioningThresholdConfidence';
import type { PreconditioningQueryState, TemperatureDeltaFormatter } from './types';

const BASE = Date.UTC(2026, 7, 8, 12);
const prefs: UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°F', pressure: 'bar',
  energy: 'kWh', power: 'kW', duration: 'min', locale: 'en-US', precision: 1,
};
const duration = (value: number | null | undefined) => formatDuration(value, prefs);
const delta: TemperatureDeltaFormatter = (value, options) => {
  const formatted = formatTemperatureDelta(value, prefs, options);
  return options?.signed && value != null && value > 0 ? `+${formatted}` : formatted;
};

function evidence() {
  const samples: PreconditioningClimateSample[] = [];
  const drives: Drive[] = [];
  for (const [index, initial, final, active] of [
    [0, 35, 24, true], [1, 34, 33, false],
    [2, 7, 19, true], [3, 8, 9, false],
  ] as const) {
    const departure = BASE + index * 2 * 60 * 60_000;
    for (const [minutes, insideTemp] of [[30, initial], [5, final]]) {
      samples.push({
        timestamp: new Date(departure - minutes * 60_000).toISOString(),
        insideTemp, driverTempSetting: 21, passengerTempSetting: 21, hvacPower: active,
      });
    }
    drives.push({
      id: index + 1, vehicleId: 7, startTs: new Date(departure).toISOString(),
      endTs: null, durationS: 600, distanceM: 1_000,
      startAddress: null, endAddress: null, startLat: null, startLon: null,
      endLat: null, endLon: null, startBatteryPct: null, endBatteryPct: null,
      energyUsedWh: null, regenEnergyWh: null, avgSpeedMps: null, maxSpeedMps: null,
      avgPowerW: null, outsideTempAvgC: null, insideTempAvgC: null, score: null,
      endedStatus: null, createdAt: '', updatedAt: '',
    });
  }
  return summarizePreconditioningEffectiveness(samples, drives, { directoryLimit: 2 });
}

function readyState(): PreconditioningQueryState {
  const source = () => ({
    hasData: true, isLoading: false, isResolved: true, isFetching: false,
    isPaused: false, error: null, refreshError: null, onRetry: vi.fn(),
  });
  return { vehicleSelected: true, climate: source(), drives: source(), onRefresh: vi.fn() };
}

function rules(file: string) {
  const result: Rule[] = [];
  postcss.parse(readFileSync(resolve(
    process.cwd(), 'src', 'components', 'ui', 'app-designs', file,
  ), 'utf8')).walkRules(rule => { result.push(rule); });
  return result;
}

const baseRules = rules('base.css');
const feedbackRules = rules('feedback.css');
const identityRules = new Map(PACK_IDS.map(pack => [pack, rules(`packs\\${pack}.css`)]));
const releases: Array<() => void> = [];

function mount(children: ReactNode, pack?: PackId) {
  const result = render(<MemoryRouter initialEntries={['/preconditioning-effectiveness']}>{pack
    ? <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>{children}</div>
    : <>{children}</>}</MemoryRouter>);
  releases.push(observeAppDesignScopes(result.container));
  return result;
}

function matches(node: Element, sheet: readonly Rule[], contract: string, property: string | RegExp) {
  return sheet.filter(rule => rule.selector.includes(contract)
    && rule.selectors.some(selector => node.matches(selector))
    && rule.nodes.some(declaration => declaration.type === 'decl'
      && (typeof property === 'string' ? declaration.prop === property : property.test(declaration.prop))));
}

function expectRecord(node: Element, pack: PackId) {
  expect(node).toHaveAttribute('data-app-card-kind', 'record');
  expect(matches(node, baseRules, '[data-app-part~="card"]', 'border-radius').length).toBeGreaterThan(0);
  expect(matches(node, identityRules.get(pack)!, '[data-app-part~="card"]', /^(border(?:-.+)?|background(?:-color)?|box-shadow)$/).length)
    .toBeGreaterThan(0);
  expect(matches(node, feedbackRules, '[data-app-card-kind="record"]', 'display').length).toBeGreaterThan(0);
}

afterEach(() => {
  releases.splice(0).forEach(release => release());
  cleanup();
});

describe('preconditioning evidence surfaces, source-only consumer activation', () => {
  it.each(PACK_IDS)('%s binds actual records, threshold readings and neutral limitations without changing evidence', pack => {
    const summary = evidence();
    const original = structuredClone(summary);
    const state = readyState();
    const { container } = mount(<>
      <PreconditioningSourceCoverage summary={summary} state={state} formatDuration={duration} locale="en-US" />
      <PreconditioningDataAvailability summary={summary} state={state} />
      <PreconditioningThresholdConfidence summary={summary} state={state} formatDuration={duration} formatDelta={delta} />
      <PreconditioningStrata summary={summary} state={state} formatDelta={delta} />
      <PreconditioningExactAccounting summary={summary} state={state} />
      <PreconditioningMethodology summary={summary} state={state} />
      <PreconditioningHourlyProfile summary={summary} state={state} formatDelta={delta} />
      <ol>{summary.directory.items.map(item => <PreconditioningDepartureCard key={item.driveId}
        item={item} formatDuration={duration} formatDelta={delta} locale="en-US" />)}</ol>
    </>, pack);

    for (const [id, count] of [
      ['preconditioning-source-coverage', 2], ['preconditioning-availability', 2],
      ['preconditioning-accounting', 7], ['preconditioning-methodology', 6],
      ['preconditioning-strata', 2], ['preconditioning-hourly-profile', 4],
    ] as const) {
      const records = screen.getByTestId(id).querySelectorAll('[data-app-card-kind="record"]');
      expect(records, id).toHaveLength(count);
      for (const record of records) {
        expectRecord(record, pack);
        const header = record.querySelector(':scope > [data-app-part~="record-header"]');
        expect(header).not.toBeNull();
        expect(matches(header!, feedbackRules, '[data-app-card-kind="record"]', 'display').length)
          .toBeGreaterThan(0);
      }
    }
    const directory = container.querySelector('ol')!;
    expect([...directory.children].map(node => node.tagName)).toEqual(['LI', 'LI']);
    expect([...directory.children].map(node => within(node as HTMLElement).getByRole('heading').textContent))
      .toEqual(summary.directory.items.map(item => `Drive ${item.driveId}`));
    for (const record of directory.children) {
      expectRecord(record, pack);
      expect(record.querySelectorAll('[data-app-metric="stat"]')).toHaveLength(11);
    }
    for (const metric of container.querySelectorAll('[data-app-metric="stat"]')) {
      expect(matches(metric, feedbackRules, '[data-app-metric="stat"]', 'padding').length).toBeGreaterThan(0);
      expect(metric.querySelector(':scope > [data-app-part~="metric-label"]')).not.toBeNull();
      expect(metric.querySelector(':scope > [data-app-part~="metric-reading"]')).not.toBeNull();
    }

    const gates = screen.getByTestId('preconditioning-threshold-confidence').querySelectorAll('[data-app-metric="tile"]');
    expect(gates).toHaveLength(7);
    for (const gate of gates) {
      expect(matches(gate, feedbackRules, '[data-app-metric="tile"]', 'padding').length).toBeGreaterThan(0);
      expect(gate.querySelector(':scope > [data-app-part~="metric-label"]')).not.toBeNull();
      const reading = gate.querySelector(':scope > [data-app-part~="metric-reading"]')!;
      expect(reading).not.toBeNull();
      expect(reading.textContent).not.toBe('');
      expect(gate.querySelector(':scope > [data-app-part~="metric-context"]')).not.toBeNull();
    }
    for (const text of [
      'Coverage reports returned telemetry only. A longer drive span does not imply climate evidence exists around every departure.',
      'A successful empty response is valid evidence of no returned rows; it is not treated as a transport failure.',
    ]) {
      const message = screen.getAllByText(text).find(node => node.getAttribute('data-app-part') === 'feedback-message')!;
      expect(message).toBeDefined();
      const notice = message.closest('[data-app-feedback-kind="notice"]')!;
      expect(notice).toHaveAttribute('data-app-tone', 'neutral');
      expect(notice.querySelector(':scope > [data-app-part~="feedback-content"]')).toContainElement(message);
      expect(matches(notice, feedbackRules, '[data-app-feedback-kind="notice"]', 'border').length).toBeGreaterThan(0);
    }
    expect(within(screen.getByTestId('preconditioning-accounting')).getAllByText('Balances')).toHaveLength(7);
    expect(summary.directory.omitted).toBe(2);
    expect(summary).toEqual(original);
  });

  it.each([
    ['not requested', { vehicleSelected: false }, {}, 'Not requested', 'Not requested'],
    ['pending', {}, { hasData: false, isResolved: false }, 'Pending', 'Pending'],
    ['loading', {}, { hasData: false, isLoading: true, isResolved: false }, 'Loading', 'Initial load'],
    ['paused', {}, { hasData: false, isPaused: true, isResolved: false }, 'Paused offline', 'Paused offline'],
    ['fatal', {}, { hasData: false, error: new Error('source failed'), isResolved: false }, 'Unavailable', 'Query failed'],
    ['retained', {}, { refreshError: new Error('refresh failed') }, 'Cached; refresh failed', 'Refresh failed; cached data retained'],
    ['refreshing', {}, { isFetching: true }, 'Refreshing', 'Refreshing'],
    ['resolved empty', {}, {}, 'Loaded', 'Resolved'],
  ] as const)('keeps independently painted source/query shells and transport distinctions for %s', (_name, page, climate, coverageStatus, queryStatus) => {
    const summary = summarizePreconditioningEffectiveness([], []);
    const state = { ...readyState(), ...page };
    Object.assign(state.climate, climate);
    mount(<>
      <PreconditioningSourceCoverage summary={summary} state={state} formatDuration={duration} locale="en-US" />
      <PreconditioningDataAvailability summary={summary} state={state} />
      <PreconditioningMethodology summary={summary} state={state} />
    </>, 'classic');
    const coverage = screen.getByTestId('preconditioning-source-coverage');
    const availability = screen.getByTestId('preconditioning-availability');
    const climateRecord = within(coverage).getByRole('heading', { name: 'Climate history source' })
      .closest('[data-app-card-kind="record"]')!;
    expect(climateRecord).not.toBeNull();
    expect(within(climateRecord as HTMLElement).getByText(coverageStatus)).toBeInTheDocument();
    const queryRecord = within(availability).getByText('Climate query').closest('[data-app-card-kind="record"]')!;
    expect(queryRecord).not.toBeNull();
    expect(within(queryRecord as HTMLElement).getByText(queryStatus)).toBeInTheDocument();
    expect(within(coverage).getByRole('heading', { name: 'Drive history source' })).toBeInTheDocument();
    expect(within(availability).getByText('Drive query')).toBeInTheDocument();
    expect(screen.getByTestId('preconditioning-methodology').querySelectorAll('article[data-app-card-kind="record"]')).toHaveLength(6);
    const resolved = state.vehicleSelected && !state.climate.isLoading && !state.climate.error
      && !state.climate.isPaused && state.climate.isResolved;
    if (resolved) expect(within(availability).getByText(/A successful empty response is valid evidence/)).toBeInTheDocument();
    else expect(within(availability).queryByText(/A successful empty response is valid evidence/)).not.toBeInTheDocument();
  });

  it('retains measured zero, withheld and signed readings plus mismatch equations rather than manufacturing comparison support', () => {
    const summary = evidence();
    summary.strata[0] = {
      ...summary.strata[0]!, conditionedCount: 0, evidence: 'none',
      startDeltaAdvantageC: null, improvementLiftC: null,
    };
    summary.strata[1] = {
      ...summary.strata[1]!, startDeltaAdvantageC: -2, improvementLiftC: 0,
    };
    summary.identities.directoryBalanced = false;
    mount(<>
      <PreconditioningStrata summary={summary} state={readyState()} formatDelta={delta} />
      <PreconditioningExactAccounting summary={summary} state={readyState()} />
    </>, 'blueprint');
    const [hot, cold] = screen.getByTestId('preconditioning-strata').querySelectorAll('article');
    const readings = (record: Element) => [...record.querySelectorAll('[data-app-part~="metric-reading"]')]
      .map(node => node.textContent);
    expect(readings(hot!)).toEqual(['0', '1', '—', '—']);
    expect(readings(cold!)).toEqual(['1', '1', delta(-2, { signed: true }), delta(0, { signed: true })]);
    expect(within(hot as HTMLElement).getByText(/both observational groups are required/)).toBeInTheDocument();
    const mismatch = screen.getByText('Mismatch').closest('[data-app-card-kind="record"]')!;
    expect(mismatch).not.toBeNull();
    expect(mismatch.querySelector('[data-app-part~="record-body"]')).toHaveTextContent(
      `${summary.directory.total} directory entries = ${summary.driveRows.uniqueValidDrives} unique valid drives`,
    );
  });

  it('keeps every departure disposition, chronology and true/off/unknown detail without rewriting source units', () => {
    const dispositions: DepartureDisposition[] = [
      'outside_climate_coverage', 'no_window_rows', 'insufficient_thermal_samples',
      'insufficient_observation_span', 'stale_departure_sample', 'target_shift',
      'initial_in_band', 'ambiguous_hvac', 'conditioned', 'unconditioned',
    ];
    const rows: DepartureDirectoryItem[] = dispositions.map((disposition, index) => ({
      driveId: index, departureMs: BASE - index * 60_000, disposition,
      regime: index < 8 ? null : 'hot', conditioned: index < 8 ? null : index === 8,
      windowRowCount: 0, thermalSampleCount: 0, hvacOnSamples: 0,
      hvacOffSamples: index === 9 ? 2 : 0, unknownHvacSamples: index < 8 ? 2 : 0,
      firstSampleLeadS: null, lastSampleLeadS: 0, observationSpanS: 300,
      targetShiftC: 0, initialDeltaC: null, startDeltaC: 0, improvementC: -2,
    }));
    const { container } = mount(<ol>{rows.map(item =>
      <PreconditioningDepartureCard key={item.driveId} item={item}
        formatDuration={duration} formatDelta={delta} locale="en-US" />)}</ol>, 'terminal');
    const records = [...container.querySelectorAll('li')];
    expect(records).toHaveLength(10);
    records.forEach((record, index) => {
      expectRecord(record, 'terminal');
      expect(within(record).getByRole('heading')).toHaveTextContent(`Drive ${index}`);
      expect(within(record).getByText(formatDateTime(new Date(rows[index]!.departureMs), { locale: 'en-US', tz: 'UTC' }))).toBeInTheDocument();
      const value = (label: string) => within(record).getByText(label)
        .parentElement!.querySelector('[data-app-part~="metric-reading"]')!;
      expect(value('First-state lead')).toHaveTextContent('—');
      expect(value('Final-state lead')).toHaveTextContent(duration(0));
      expect(value('Observed improvement')).toHaveTextContent(delta(-2, { signed: true }));
      expect(value('Comparison group')).toHaveTextContent(index < 8 ? '—' : index === 8 ? 'HVAC-active' : 'Explicit-off control');
    });
  });

  it('does not activate source records in default, widget-only or incomplete profiles', () => {
    const summary = evidence();
    const source = <PreconditioningSourceCoverage summary={summary} state={readyState()} formatDuration={duration} locale="en-US" />;
    const { container } = mount(<>
      {source}
      <div data-app-design-preview="" data-app-design-pack="blueprint">{source}</div>
      <div data-app-design-preview="" {...getAppDesignAttributes('v2')} data-app-data="ledger">{source}</div>
    </>);
    const records = container.querySelectorAll('[data-app-card-kind="record"]');
    expect(records).toHaveLength(6);
    for (const record of records) {
      expect(record).not.toHaveAttribute('data-app-design-owner');
      expect(matches(record, baseRules, '[data-app-part~="card"]', 'border-radius')).toEqual([]);
      expect(record).toHaveClass('rounded-xl', 'bg-[var(--surface-2)]', 'p-4');
    }
  });
});
