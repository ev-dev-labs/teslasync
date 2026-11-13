import { cloneElement, isValidElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import type { Drive } from '@/types/driving';
import type { PeriodStats, ScoredDrive } from '../pages/DriveScorePage';
import { analyzeArrivalReliability } from '../lib/arrivalReliability';
import { summarizeColdStarts, type ColdStartSummary } from '../lib/coldStart';
import { forecastDepartures } from '../lib/departureForecast';
import { ArrivalReliabilityMethodology } from './arrival-reliability/ArrivalReliabilityMethodology';
import { ArrivalReliabilityRouteDirectory } from './arrival-reliability/ArrivalReliabilityRouteDirectory';
import { ArrivalReliabilitySectionBody } from './arrival-reliability/ArrivalReliabilitySectionBody';
import { ArrivalReliabilityWindowComparisons } from './arrival-reliability/ArrivalReliabilityWindowComparisons';
import type { ArrivalReliabilityQueryState } from './arrival-reliability/types';
import { ColdStartMethodology } from './cold-start/ColdStartMethodology';
import { ColdStartOpportunities } from './cold-start/ColdStartOpportunities';
import { ColdWarmComparison } from './cold-start/ColdWarmComparison';
import { ScoreAchievements } from './continuation-driving-primary/ScoreAchievements';
import { ScoreExtremeDrive } from './continuation-driving-primary/ScoreExtremeDrive';
import { ScorePeriodAverages } from './continuation-driving-primary/ScorePeriodAverages';
import { DepartureForecastEvidenceMetricGroup } from './departure-forecast/DepartureForecastEvidenceMetricGroup';
import { DepartureForecastEvidenceQuality } from './departure-forecast/DepartureForecastEvidenceQuality';
import { DepartureForecastHourDistribution } from './departure-forecast/DepartureForecastHourDistribution';
import { DepartureForecastMethodology } from './departure-forecast/DepartureForecastMethodology';
import { DepartureForecastRankedWindows } from './departure-forecast/DepartureForecastRankedWindows';
import { departureDateTime } from './departure-forecast/labels';

const displayUnits = vi.hoisted(() => ({ distance: 'km', temperature: 'C' }));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    locale: 'en-US', decimals: 2,
    settings: {
      locale: 'en-US', unit_of_length: displayUnits.distance, unit_of_temp: displayUnits.temperature, unit_of_pressure: 'kPa',
      decimal_precision: 2, currency_symbol: '$', chart_palette: 'cb_safe',
      tz_display_default: 'utc', timezone_user: 'UTC',
    },
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDate: (value: string) => value,
    formatDateTime: (value: string) => value,
    formatDateRange: (start: string, end: string) => `${start}–${end}`,
  }),
}));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ResponsiveContainer: ({ children }: { children: ReactNode }) =>
    isValidElement<{ width?: number; height?: number }>(children)
      ? cloneElement(children, { width: 800, height: 300 })
      : children,
}));

afterEach(cleanup);
beforeEach(() => {
  displayUnits.distance = 'km';
  displayUnits.temperature = 'C';
});

const now = Date.parse('2026-08-08T06:00:00Z');
const drives: Drive[] = [1, 2, 3].map(id => ({
  id, vehicleId: 7, startTs: `2026-08-0${id}T08:00:00Z`,
  endTs: `2026-08-0${id}T08:30:00Z`, durationS: 1800, distanceM: 20000,
  startAddress: 'Home', endAddress: 'Office',
  startLat: null, startLon: null, endLat: null, endLon: null,
  startBatteryPct: null, endBatteryPct: null, energyUsedWh: 3000, regenEnergyWh: null,
  avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null,
  outsideTempAvgC: null, insideTempAvgC: null, score: null,
  endedStatus: 'completed', createdAt: '', updatedAt: '',
}));
const arrival = analyzeArrivalReliability(drives, now, 'UTC');
const forecast = forecastDepartures(drives, now, 'UTC');
const ready: ArrivalReliabilityQueryState = {
  vehicleSelected: true, isLoading: false, fetchStatus: 'idle',
  isRefreshBlocked: false, isResolved: true, error: null, refreshError: null, onRetry: vi.fn(),
};
const coldState = { isLoading: false, retained: true, error: null, onRetry: vi.fn() };
const duration = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) ? `${value / 60} min` : '—';
const period: PeriodStats = {
  thisWeekAvg: 0, lastWeekAvg: null, thisMonthAvg: 80, lastMonthAvg: 70,
  bestWeek: { avg: 90, label: '2026-W31' }, bestMonth: { avg: 85, label: '2026-07' },
  totalDrives: 10, aOrBetter: 0,
};
const cold: ColdStartSummary = {
  ...summarizeColdStarts([]),
  cold: { drives: 5, distanceM: 10000, whPerKm: 200 },
  warm: { drives: 5, distanceM: 10000, whPerKm: 150 },
  sampleSufficient: true, penaltyWhPerKm: 50, penaltyShare: 1 / 3, totalPenaltyWh: 500,
  ambiguous: 2, unclassified: 1,
  opportunities: [{
    driveId: 1, startTs: drives[0].startTs, precedingGapS: 21600,
    distanceM: 20000, outsideTempAvgC: null, estimatedAvoidableWh: 0,
  }],
};
const baseCss = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'));
const feedbackCss = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'));
const identityCss = new Map<PackId, postcss.Root>(PACK_IDS.map(pack => [
  pack, postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8')),
]));

function show(children: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>);
}

function hasConsumer(element: Element, css: postcss.Root, property: string, contract = '') {
  let matches = false;
  css.walkRules(rule => {
    if (matches) return;
    if (rule.selector.includes('data-app-design-owner')
      && rule.nodes.some(node => node.type === 'decl' && node.prop.startsWith(property))
      && rule.selectors.some(selector => selector.includes(contract)
        && [...element.ownerDocument.querySelectorAll(selector)].includes(element))) matches = true;
  });
  return matches;
}

describe('driving-01 native ownership', () => {
  it.each(PACK_IDS)('%s composes all fourteen real renderers through their existing surface, data and feedback consumers', pack => {
    const bytes = JSON.stringify({ arrival, forecast, cold, period });
    const view = show(<div data-app-design-preview {...getAppDesignAttributes(pack)}>
      <ArrivalReliabilityMethodology analysis={arrival} timeZone="UTC" />
      <ArrivalReliabilityRouteDirectory analysis={arrival} state={ready} locale="en-US" formatDuration={duration} />
      <ArrivalReliabilityWindowComparisons analysis={arrival} state={ready} locale="en-US" timeZone="UTC" formatDuration={duration} />
      <ColdStartMethodology summary={cold} observedDrives={13} windowLimit={1000} state={coldState} />
      <ColdStartOpportunities summary={cold} state={coldState} />
      <ColdWarmComparison summary={cold} penaltyCostLabel={null} state={coldState} />
      <ScoreAchievements items={[
        { id: 'locked', label: 'Locked evidence', description: 'No unlock without source evidence', icon: null, unlocked: false },
        { id: 'observed', label: 'Observed evidence', description: 'Observed unlock only', icon: null, unlocked: true },
      ]} sourceFallback={null} />
      <ScoreExtremeDrive kind="best" entry={{
        drive: drives[0],
        score: { total: 0, grade: 'F', efficiency: 0, smoothness: 0, speed: 0, whPerKm: 0 },
      }} badgeVariant="neutral" sourceFallback={null} insight="Local heuristic, not a server measurement"
        formatDistance={value => `${value} source distance`} formatEfficiency={value => `${value} source efficiency`} />
      <ScorePeriodAverages stats={period} />
      <DepartureForecastEvidenceQuality forecast={forecast} state={ready} locale="en-US" />
      <DepartureForecastHourDistribution forecast={forecast} state={ready} locale="en-US" timeZone="UTC" />
      <DepartureForecastMethodology forecast={forecast} locale="en-US" timeZone="UTC" timeZoneProvenance="Selected UTC" />
      <DepartureForecastRankedWindows forecast={forecast} state={ready} locale="en-US" timeZone="UTC" />
      <ArrivalReliabilitySectionBody analysis={arrival} state={{ ...ready, isResolved: false }}>
        <span>Not yet ready</span>
      </ArrivalReliabilitySectionBody>
    </div>);
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const design = APPLICATION_DESIGNS[pack];
      const frames = host.querySelectorAll('[data-app-part="card"]');
      expect(frames).toHaveLength(8 + arrival.routes.length + arrival.supportedWindows.length + 2 + 8);
      for (const frame of frames) {
        expect(frame).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
        expect(hasConsumer(frame, baseCss, 'border-radius', '[data-app-part~="card"]')).toBe(true);
        expect(hasConsumer(frame, identityCss.get(pack)!, 'border', '[data-app-part~="card"]'), frame.outerHTML).toBe(true);
      }
      const records = host.querySelectorAll('[data-app-list="definitions"] > [data-app-part="list-row"], [data-app-list="ranked"] > [data-app-part="list-row"]');
      expect(records.length).toBeGreaterThanOrEqual(8 + forecast.rankedWindows.length);
      for (const record of records) {
        expect(hasConsumer(record, feedbackCss, 'display', `[data-app-data="${design.data}"]`)).toBe(true);
        expect(record.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
        expect(record.querySelector('[data-app-part~="metric-value"]')).not.toBeEmptyDOMElement();
      }
      const tiles = host.querySelectorAll('[data-app-metric="tile"], [data-app-metric="stat"]');
      expect(tiles).toHaveLength(3 + 3 + 6 + 22 + 4);
      for (const tile of tiles) {
        expect(hasConsumer(tile, feedbackCss, 'padding', `[data-app-data="${design.data}"]`), tile.outerHTML).toBe(true);
        expect(tile.querySelector('[data-app-part="metric-label"]')).not.toBeEmptyDOMElement();
        const reading = tile.querySelector('[data-app-part="metric-reading"]')!;
        expect(reading).not.toBeEmptyDOMElement();
        expect(hasConsumer(reading, feedbackCss, 'font-variant-numeric', '[data-app-part~="metric-reading"]')).toBe(true);
      }
      for (const insight of host.querySelectorAll('[data-app-feedback-kind="insight"]')) {
        expect(hasConsumer(insight, feedbackCss, 'border', `[data-app-feedback="${design.feedback}"]`)).toBe(true);
        expect(hasConsumer(insight.querySelector('[data-app-part="feedback-message"]')!, feedbackCss, 'white-space')).toBe(true);
      }
      const comparison = host.querySelector('[data-app-part="metric-comparison"]')!;
      expect(comparison.parentElement).toHaveAttribute('data-app-metric', 'stat');
      expect(hasConsumer(comparison, feedbackCss, 'white-space')).toBe(true);
      if (design.data === 'ledger') {
        expect(hasConsumer(comparison, feedbackCss, 'grid-column', '[data-app-part~="metric-comparison"]')).toBe(true);
      }
      const passive = host.querySelector('[data-app-source-state="pending"]')!;
      expect(hasConsumer(passive, feedbackCss, 'display', `[data-app-feedback="${design.feedback}"]`)).toBe(true);
      expect(hasConsumer(passive.querySelector('[data-app-part="feedback-content"]')!, feedbackCss, 'grid-column')).toBe(true);
      expect(passive.querySelector('[role="status"], [role="alert"], [aria-live], button')).toBeNull();
      expect(screen.getByRole('meter', { name: 'Score' })).toHaveAttribute('aria-valuenow', '0');
      expect(screen.getAllByRole('progressbar').filter(node => node.hasAttribute('aria-valuenow'))
        .map(node => node.getAttribute('aria-valuenow'))).toEqual(['200', '150']);
      expect(host.querySelector('.recharts-bar')).toBeInTheDocument();
      expect(host.querySelectorAll('[data-chart-family="linear-gauge"]')).toHaveLength(1);
      expect(screen.getByText('Local heuristic, not a server measurement')).toBeInTheDocument();
      expect(JSON.stringify({ arrival, forecast, cold, period })).toBe(bytes);

      const frame = frames[0];
      frame.removeAttribute('data-app-design-owner');
      expect(hasConsumer(frame, baseCss, 'border-radius')).toBe(false);
      expect(hasConsumer(frame, identityCss.get(pack)!, 'border', '[data-app-part~="card"]')).toBe(false);
      const neutral = document.createElement('div');
      neutral.setAttribute('data-app-design-preview', '');
      neutral.append(frame.cloneNode(true));
      host.append(neutral);
      const refresh = observeAppDesignScopes(neutral);
      expect(neutral.querySelector('article')).not.toHaveAttribute('data-app-design-owner');
      expect(hasConsumer(neutral.querySelector('article')!, baseCss, 'border-radius')).toBe(false);
      refresh();
    } finally { release(); }
  });

  it('keeps eight route facts and supported window cards without replacing the real embedded brief', () => {
    const view = show(<>
      <ArrivalReliabilityRouteDirectory analysis={arrival} state={ready} locale="en-US" formatDuration={duration} />
      <ArrivalReliabilityWindowComparisons analysis={arrival} state={ready} locale="en-US" timeZone="UTC" formatDuration={duration} />
    </>);
    const route = screen.getByTestId('arrival-route-directory').querySelector('article')!;
    const rows = route.querySelectorAll('[data-app-list="definitions"] > [data-app-part="list-row"]');
    expect(rows).toHaveLength(8);
    expect([...rows].map(row => row.querySelector('[data-app-part="metric-value"]')?.textContent))
      .toEqual(['3', '3', '30 min', '30 min', '0 min', '0 min', '100.00', expect.any(String)]);
    expect(route).toHaveAttribute('data-app-part', 'card');
    const windows = screen.getByTestId('arrival-window-comparisons').querySelectorAll('article');
    expect(windows).toHaveLength(arrival.supportedWindows.length);
    expect(windows[0]).toHaveTextContent('Only supported route-window');
    expect(windows[0].querySelector('[data-operational-brief-surface="embedded"]')).toBeInTheDocument();
    view.rerender(<MemoryRouter><ArrivalReliabilityRouteDirectory
      analysis={analyzeArrivalReliability([], now, 'UTC')} state={ready}
      locale="en-US" formatDuration={duration} /></MemoryRouter>);
    expect(screen.getByTestId('arrival-route-directory').querySelector('article')).toBeNull();
    expect(screen.getByText('No drives were returned, so there is no route timing evidence.')).toBeInTheDocument();
  });

  it.each([
    ['no-vehicle', { vehicleSelected: false }, 'Select a vehicle'],
    ['pending', { isResolved: false }, 'has not resolved'],
    ['paused', { isResolved: false, isRefreshBlocked: true }, 'loading is paused'],
    ['unavailable', { error: new Error('offline') }, 'retry from the evidence status above'],
  ] as const)('keeps %s passive and distinct without extra retries or live regions', (sourceState, patch, message) => {
    const { container } = show(<ArrivalReliabilitySectionBody analysis={arrival} state={{ ...ready, ...patch }}>
      <span>Ready records</span>
    </ArrivalReliabilitySectionBody>);
    const feedback = container.querySelector(`[data-app-source-state="${sourceState}"]`)!;
    expect(feedback).toHaveAttribute('data-app-feedback-kind', 'notice');
    expect(feedback.querySelector('[data-app-part="feedback-message"]')).toHaveTextContent(message);
    expect(feedback.querySelector('[data-app-part="feedback-icon"]')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[role="status"], [role="alert"], [aria-live], button')).toBeNull();
    expect(screen.queryByText('Ready records')).not.toBeInTheDocument();
  });

  it('preserves empty, unsupported and retained arrival evidence gates', () => {
    const { container, rerender } = show(<ArrivalReliabilitySectionBody analysis={analyzeArrivalReliability([], now, 'UTC')} state={ready}>
      <span>Ready records</span>
    </ArrivalReliabilitySectionBody>);
    expect(container.querySelector('[data-app-source-state="empty"]')).toHaveTextContent('No drives were returned');
    rerender(<ArrivalReliabilitySectionBody analysis={analyzeArrivalReliability(drives.slice(0, 1), now, 'UTC')} state={ready}>
      <span>Ready records</span>
    </ArrivalReliabilitySectionBody>);
    expect(container.querySelector('[data-app-source-state="unsupported-routes"]')).toHaveTextContent('three included drives');
    rerender(<ArrivalReliabilitySectionBody analysis={arrival} state={{ ...ready, refreshError: new Error('refresh'), isRefreshBlocked: true }}>
      <span>Ready records</span>
    </ArrivalReliabilitySectionBody>);
    expect(screen.getByText('Ready records')).toBeInTheDocument();
    expect(container.querySelector('[data-app-feedback-kind]')).toBeNull();
  });

  it('distinguishes rejected timing evidence, unsupported windows and loading without adding a live status or controls', () => {
    const invalid = analyzeArrivalReliability([{ ...drives[0], startTs: 'invalid' }], now, 'UTC');
    const sparseWindows = analyzeArrivalReliability(drives.map((drive, index) => ({
      ...drive,
      startTs: drive.startTs.replace('08:', `${10 + index * 2}:`),
      endTs: drive.endTs!.replace('08:', `${10 + index * 2}:`),
    })), now, 'UTC');
    const { container, rerender } = show(<ArrivalReliabilitySectionBody analysis={invalid} state={ready}>
      Ready evidence
    </ArrivalReliabilitySectionBody>);
    expect(container.querySelector('[data-app-source-state="no-qualified"]')).toHaveTextContent('valid, non-future timing');
    rerender(<ArrivalReliabilitySectionBody analysis={sparseWindows} state={ready} requirement="windows">
      Ready evidence
    </ArrivalReliabilitySectionBody>);
    expect(container.querySelector('[data-app-source-state="unsupported-windows"]')).toHaveTextContent('local two-hour window');
    rerender(<div data-app-design-preview {...getAppDesignAttributes('cyber')}>
      <ArrivalReliabilitySectionBody analysis={arrival} state={{ ...ready, isLoading: true }} skeletonHeight={177}>
        Ready evidence
      </ArrivalReliabilitySectionBody>
    </div>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      expect(screen.getByLabelText('Loading arrival timing history')).toBeInTheDocument();
      const skeleton = container.querySelector('[data-app-part="skeleton"]')!;
      expect(skeleton).toHaveAttribute('aria-hidden', 'true');
      expect(skeleton).toHaveStyle({ height: '177px' });
      expect(skeleton).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-cyber'));
      expect(container.querySelector('[role="status"], [role="alert"], [aria-live], button')).toBeNull();
      expect(screen.queryByText('Ready evidence')).not.toBeInTheDocument();
    } finally { release(); }
  });

  it('keeps eight independent route facts, source formatter output and unavailable durations on long route cards', () => {
    const label = 'A complete long directional route with destination provenance '.repeat(5);
    const format = vi.fn(duration);
    const analysis = { ...arrival, routes: [{
      ...arrival.routes[0], label, p50DurationS: Number.NaN, p90DurationS: Number.POSITIVE_INFINITY,
    }] };
    const { container } = show(<ArrivalReliabilityRouteDirectory analysis={analysis}
      state={ready} locale="de-DE" formatDuration={format} />);
    const rows = container.querySelectorAll('dl > [data-app-part="list-row"]');
    expect(rows).toHaveLength(8);
    expect(rows[2].querySelector('dd')).toHaveTextContent('—');
    expect(rows[3].querySelector('dd')).toHaveTextContent('—');
    expect(rows[4].querySelector('dd')).toHaveTextContent('0 min');
    expect(rows[6].querySelector('dd')).toHaveTextContent('100,00');
    expect(screen.getByRole('heading', { name: label.trim() })).toBeInTheDocument();
    expect(format.mock.calls.map(([value]) => value)).toEqual([Number.NaN, Number.POSITIVE_INFINITY, 0, 0]);
  });

  it('preserves the first-five-plus-lowest window selection, original rank and support instead of reordering by presentation', () => {
    const supportedWindows = Array.from({ length: 8 }, (_, index) => ({
      ...arrival.supportedWindows[0], routeKey: `route-${index}`, routeLabel: `Full source route ${index}`,
      bucketStartHour: index * 2,
    }));
    const analysis = { ...arrival, supportedWindows, soleSupportedWindow: null };
    show(<ArrivalReliabilityWindowComparisons analysis={analysis}
      state={ready} locale="en-US" timeZone="UTC" formatDuration={duration} />);
    const records = screen.getByTestId('arrival-window-comparisons').querySelectorAll('article');
    expect([...records].map(record => within(record).getByRole('heading', { name: /^Full source route/ }).textContent))
      .toEqual([0, 1, 2, 3, 4, 7].map(index => `Full source route ${index}`));
    expect(records[0]).toHaveTextContent('Highest observed timing consistency');
    expect(records[5]).toHaveTextContent('Lowest observed timing consistency');
    expect(records[5]).toHaveTextContent('3 samples · route allowance 35 min');
    expect(records[5].querySelector('[data-operational-brief-surface="embedded"]')).toBeInTheDocument();
  });

  it.each([4, 5])('owns cold evidence numerators and floors at %s samples without changing support or cap copy', count => {
    const summary = { ...cold, cold: { ...cold.cold, drives: count }, sampleSufficient: count === 5 };
    const { container } = show(<ColdStartMethodology summary={summary} observedDrives={1000} windowLimit={1000} state={coldState} />);
    const values = container.querySelectorAll('[data-app-metric="tile"] [data-app-part="metric-value"]');
    expect([...values].map(value => value.textContent)).toEqual([`${count}/5`, '5/5', String(count + 5)]);
    expect(screen.getByText(count === 5 ? 'Penalty claim supported' : 'More samples needed')).toBeInTheDocument();
    expect(container.querySelector('[data-app-feedback-kind="insight"] [data-app-part="feedback-message"]'))
      .toHaveTextContent('reached the 1,000-drive API cap');
    expect(screen.getByText(/2 observations between them remain ambiguous/)).toBeInTheDocument();
    expect(screen.getByText(/1 usable drives could not be classified/)).toBeInTheDocument();
  });

  it.each([0, Number.NaN])('keeps %s cohort evidence distinct from the fixed floor and never invents classified support', count => {
    const summary = { ...cold, cold: { ...cold.cold, drives: count }, warm: { ...cold.warm, drives: count }, sampleSufficient: false };
    const { container } = show(<ColdStartMethodology summary={summary} observedDrives={13} windowLimit={1000} state={coldState} />);
    const values = [...container.querySelectorAll('[data-app-metric="tile"] [data-app-part="metric-value"]')].map(node => node.textContent);
    expect(values).toEqual(count === 0 ? ['0/5', '0/5', '0'] : ['—/5', '—/5', '—']);
    expect(screen.getByText('More samples needed')).toBeInTheDocument();
    expect(container.querySelector('[data-app-feedback-kind="insight"]')).toHaveTextContent('uses 13 drives returned');
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });

  it.each([50, 0, -50, null])('keeps the original noncausal takeaway for %s cold-minus-warm consumption', penaltyWhPerKm => {
    const { container } = show(<ColdWarmComparison summary={{ ...cold, penaltyWhPerKm }}
      penaltyCostLabel={null} state={coldState} />);
    const feedback = container.querySelector('[data-app-feedback-kind="insight"]')!;
    expect(feedback).toHaveAttribute('data-app-tone', 'neutral');
    expect(feedback.querySelector('[data-app-part="feedback-message"]')).toHaveTextContent(
      penaltyWhPerKm != null && penaltyWhPerKm > 0
        ? 'This is not measured warm-up energy or guaranteed savings'
        : 'No positive whole-drive difference or savings is claimed',
    );
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '200');
  });

  it('owns only the opportunity metric bank and preserves zero energy, missing temperature and SI display formatting', () => {
    const { container } = show(<ColdStartOpportunities summary={cold} state={coldState} />);
    const record = screen.getByRole('listitem');
    expect(record).not.toHaveAttribute('data-app-part', 'card');
    const bank = record.querySelector('[data-app-part="metric-grid"]')!;
    const values = bank.querySelectorAll('[data-app-part="metric-value"]');
    expect(values).toHaveLength(3);
    expect(values[0]).toHaveTextContent('20.00 km');
    expect(values[1]).toHaveTextContent('—');
    expect(values[2]).toHaveTextContent('0.00 kWh');
    expect(container.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(3);
    expect(record).toHaveTextContent(drives[0].startTs);
  });

  it('uses the saved imperial display preferences without rewriting SI observations or source opportunity order', () => {
    displayUnits.distance = 'mi';
    displayUnits.temperature = 'F';
    const summary = { ...cold, opportunities: [
      { ...cold.opportunities[0], driveId: 2, outsideTempAvgC: 0, estimatedAvoidableWh: -1000 },
      cold.opportunities[0],
    ] };
    const bytes = JSON.stringify(summary);
    show(<ColdStartOpportunities summary={summary} state={coldState} />);
    const records = screen.getAllByRole('listitem');
    expect(records).toHaveLength(2);
    expect(records[0]).toHaveTextContent('#1');
    expect(records[1]).toHaveTextContent('#2');
    const values = [...records[0].querySelectorAll('[data-app-part="metric-value"]')].map(node => node.textContent);
    expect(values).toEqual(['12.43 mi', '32.00°F', '-1.00 kWh']);
    expect(records[1].querySelectorAll('[data-app-part="metric-value"]')[1]).toHaveTextContent('—');
    expect(JSON.stringify(summary)).toBe(bytes);
  });

  it('owns real dayparts and keeps the existing hourly plot and calendar qualifiers', () => {
    const { container } = show(<DepartureForecastHourDistribution forecast={forecast} state={ready} locale="en-US" timeZone="UTC" />);
    const bank = screen.getByLabelText('Departure daypart distribution', { selector: 'dl' });
    expect(bank).toHaveAttribute('data-app-list', 'definitions');
    expect(within(bank).getAllByRole('term')).toHaveLength(4);
    expect(within(bank).getAllByRole('definition').map(reading => reading.textContent))
      .toEqual(['0 · 0.00%', '3 · 100.00%', '0 · 0.00%', '0 · 0.00%']);
    expect(container.querySelector('.recharts-bar')).toBeInTheDocument();
    expect(container.querySelector('[data-app-part~="chart-plot"]')).toBeInTheDocument();
    expect(screen.getByText('All hour and daypart labels use your selected time zone.')).toBeInTheDocument();
    const table = screen.getByRole('table');
    const tableRows = within(table).getAllByRole('row');
    expect(tableRows).toHaveLength(25);
    expect(tableRows.slice(1).map(row => within(row).getAllByRole('cell')[1].textContent))
      .toEqual(forecast.localHourDistribution.map(row => String(row.departures)));
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Local hour', 'Recorded departures', 'Share of included departures (%)']);
  });

  it('retains ready zero accounting versus unknown denominators, and gates unresolved evidence without exposing fake tiles', () => {
    const empty = forecastDepartures([], now, 'UTC');
    const { container, rerender } = show(<DepartureForecastEvidenceQuality forecast={empty} state={ready} locale="en-US" />);
    const values = [...container.querySelectorAll('[data-app-metric="tile"] [data-app-part="metric-value"]')].map(node => node.textContent);
    expect(values).toHaveLength(22);
    expect(values.slice(0, 6)).toEqual(['0', '0', '0', '0', '0', '0']);
    expect(values[8]).toBe('—');
    expect(values.slice(14)).toEqual(['—', '—', '—', '—', '—', '—', '—', '—']);
    rerender(<DepartureForecastEvidenceQuality forecast={empty} state={{ ...ready, isResolved: false, isRefreshBlocked: true }} locale="en-US" />);
    expect(container.querySelector('[data-app-metric="tile"]')).toBeNull();
    expect(screen.getByText(/loading is paused/)).toBeInTheDocument();
    expect(container.querySelector('[role="status"], [role="alert"], [aria-live], button')).toBeNull();
    rerender(<DepartureForecastEvidenceQuality forecast={forecast} state={{
      ...ready, refreshError: new Error('retained'), isRefreshBlocked: true,
    }} locale="en-US" />);
    expect(container.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(22);
    expect(screen.getByText(/not statistical confidence/)).toBeInTheDocument();
  });

  it('owns departure evidence tiles and complete methodology frames without parsing formatted facts', () => {
    const { container } = show(<>
      <DepartureForecastEvidenceMetricGroup title="Source facts" metrics={[
        { label: 'Zero', value: '0' }, { label: 'Unavailable denominator', value: '—' },
        { label: 'Localized reading with units', value: '1.234,50 arbitrary source units' },
      ]} />
      <DepartureForecastMethodology forecast={forecast} locale="en-US" timeZone="UTC" timeZoneProvenance="Selected UTC" />
    </>);
    expect([...container.querySelectorAll('[data-app-metric="tile"] [data-app-part="metric-value"]')].map(node => node.textContent))
      .toEqual(['0', '—', '1.234,50 arbitrary source units']);
    expect(container.querySelectorAll('article[data-app-part="card"][data-surface-variant="standalone"]')).toHaveLength(8);
    expect(screen.getByText(/Poisson event cell with a Gamma prior/)).toBeInTheDocument();
    expect(screen.getByText(/not verified telemetry coverage|No telemetry uptime/)).toBeInTheDocument();
    expect(screen.getByText(/It does not schedule climate/)).toBeInTheDocument();
    expect(screen.getByText(/Selected UTC/)).toBeInTheDocument();
  });

  it('retains ranked source order, likelihood, timezone and evidence in two-cell record anatomy', () => {
    show(<DepartureForecastRankedWindows forecast={forecast} state={ready} locale="en-US" timeZone="UTC" />);
    const records = screen.getAllByRole('listitem');
    expect(records).toHaveLength(forecast.rankedWindows.length);
    for (const [index, record] of records.entries()) {
      expect(record).toHaveAttribute('data-app-part', 'list-row');
      expect(record.children).toHaveLength(2);
      expect(record.querySelector('[data-app-part="metric-label"]')).toHaveTextContent(
        departureDateTime(forecast.rankedWindows[index].startMs, 'en-US', 'UTC'));
      expect(record.querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('% modeled');
      expect(within(record).getByText(`#${index + 1}`)).toBeInTheDocument();
      expect(record.querySelector('[data-app-part="metric-context"]')).toHaveTextContent('model-assumed calendar opportunities');
    }
  });

  it('owns period readings and comparisons while keeping missing prior values, measured zero and all six shells', () => {
    const { container, rerender } = show(<ScorePeriodAverages stats={period} />);
    const tiles = container.querySelectorAll('[data-app-metric="stat"]');
    expect(tiles).toHaveLength(6);
    expect(tiles[0].querySelector('[data-app-part="metric-value"]')).toHaveTextContent('0');
    expect(tiles[0].querySelector('[data-app-part="metric-comparison"]')).toBeNull();
    expect(tiles[0].querySelector('[data-app-part="metric-context"]')).toHaveTextContent('vs — last week');
    expect(tiles[1].querySelector('[data-app-part="metric-comparison"]')).toHaveTextContent('Increased by');
    expect(tiles[5].querySelector('[data-app-part="metric-context"]')).toHaveTextContent('0% of drives');
    rerender(<ScorePeriodAverages stats={null} sourceFallback={<span>Source unresolved</span>} />);
    expect(container.querySelectorAll('[data-app-metric="stat"]')).toHaveLength(6);
    expect(container.querySelector('[data-app-part="metric-value"]')).toBeNull();
    expect(screen.getAllByText('Source unresolved')).toHaveLength(6);
  });

  it('owns locked/unlocked achievement frames without unlocking unavailable evidence', () => {
    const items = [
      { id: 'locked', label: 'Locked condition', description: 'Requires observed history', icon: null, unlocked: false },
      { id: 'unlocked', label: 'Observed condition', description: 'Observed history only', icon: null, unlocked: true },
    ];
    const { container, rerender } = show(<ScoreAchievements items={items} sourceFallback={null} />);
    const records = screen.getAllByRole('listitem');
    expect(records.map(record => record.getAttribute('data-app-part'))).toEqual(['card', 'card']);
    expect(records[0]).not.toHaveTextContent('Unlocked');
    expect(records[1]).toHaveTextContent('Unlocked');
    expect(records[1]).toHaveClass('bg-amber-500/10');
    rerender(<ScoreAchievements items={items} sourceFallback={<span>History unavailable</span>} />);
    expect(screen.getByText('History unavailable')).toBeInTheDocument();
    expect(container.querySelector('li')).toBeNull();
    expect(screen.queryByText('Unlocked')).not.toBeInTheDocument();
  });

  it.each(['best', 'worst'] as const)('keeps %s score insight tone and the existing quantitative control', kind => {
    const entry: ScoredDrive = {
      drive: drives[0],
      score: { total: 0, grade: 'F', efficiency: 0, smoothness: 0, speed: 0, whPerKm: 0 },
    };
    const { container } = show(<ScoreExtremeDrive kind={kind} entry={entry} badgeVariant="neutral"
      sourceFallback={null} insight="Local heuristic, not a server measurement"
      formatDistance={value => `${value} source distance`} formatEfficiency={value => `${value} source efficiency`} />);
    const feedback = container.querySelector('[data-app-feedback-kind="insight"]')!;
    expect(feedback).toHaveAttribute('data-app-tone', kind === 'best' ? 'success' : 'danger');
    expect(feedback.querySelector('[data-app-part="feedback-message"]')).toHaveTextContent('Local heuristic');
    expect(screen.getByRole('meter', { name: 'Score' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('20000 source distance')).toBeInTheDocument();
    expect(screen.getByText('0 source efficiency')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-chart-family="linear-gauge"]')).toHaveLength(1);
  });

  it('keeps an absent or unavailable extreme distinct from a measured zero and does not invent an insight', () => {
    const entry: ScoredDrive = {
      drive: drives[0],
      score: { total: Number.NaN, grade: 'F', efficiency: 0, smoothness: 0, speed: 0, whPerKm: 0 },
    };
    const props = { kind: 'worst' as const, badgeVariant: 'danger' as const, sourceFallback: null,
      insight: 'Incomplete local score', formatDistance: duration, formatEfficiency: duration };
    const { container, rerender } = show(<ScoreExtremeDrive {...props} entry={entry} />);
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Score' })).toBeInTheDocument();
    rerender(<ScoreExtremeDrive {...props} entry={null} />);
    expect(screen.getByText('No drives available')).toBeInTheDocument();
    expect(container.querySelector('[data-app-feedback-kind="insight"], [role="meter"]')).toBeNull();
    rerender(<ScoreExtremeDrive {...props} entry={entry} sourceFallback={<span>Source unavailable</span>} />);
    expect(screen.getByText('Source unavailable')).toBeInTheDocument();
    expect(container.querySelector('[data-app-feedback-kind="insight"], [data-chart-family="linear-gauge"]')).toBeNull();
  });

  it('uses the nearest complete profile and keeps incomplete, widget-only and unselected native readouts neutral', () => {
    const records = <>
      <ScorePeriodAverages stats={period} />
      <DepartureForecastEvidenceMetricGroup title="Source observations" metrics={[{ label: 'Zero evidence', value: '0' }]} />
      <ArrivalReliabilitySectionBody analysis={arrival} state={{ ...ready, isResolved: false }}>Not yet ready</ArrivalReliabilitySectionBody>
    </>;
    const { container } = show(<>
      <div data-testid="unselected">{records}</div>
      <div data-app-design-preview {...getAppDesignAttributes('classic')}>
        <div data-testid="nested" data-app-design-preview {...getAppDesignAttributes('editorial')}>{records}</div>
        <div data-testid="incomplete" data-app-design-preview data-app-design-pack="v1">{records}</div>
        <div data-testid="widget-only" data-app-design-preview>{records}</div>
      </div>
    </>);
    const release = observeAppDesignScopes(container);
    try {
      for (const id of ['unselected', 'incomplete', 'widget-only']) {
        const scope = screen.getByTestId(id);
        for (const target of scope.querySelectorAll('[data-app-part]')) expect(target).not.toHaveAttribute('data-app-design-owner');
        expect(hasConsumer(scope.querySelector('[data-app-metric="stat"]')!, feedbackCss, 'padding')).toBe(false);
        expect(hasConsumer(scope.querySelector('[data-app-feedback-kind="notice"]')!, feedbackCss, 'display')).toBe(false);
      }
      const nested = screen.getByTestId('nested');
      const stat = nested.querySelector('[data-app-metric="stat"]')!;
      expect(stat).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-editorial'));
      expect(hasConsumer(stat, feedbackCss, 'padding', '[data-app-data="ledger"]')).toBe(true);
      expect(hasConsumer(stat, feedbackCss, 'padding', '[data-app-data="table"]')).toBe(false);
      expect(nested.querySelector('[data-app-feedback-kind="notice"]')).toHaveTextContent('has not resolved');
    } finally { release(); }
  });

  it('keeps the actual embedded window disclosure, full metric context and keyboard dismissal working', async () => {
    show(<ArrivalReliabilityWindowComparisons analysis={arrival} state={ready}
      locale="en-US" timeZone="UTC" formatDuration={duration} />);
    const record = screen.getByTestId('arrival-window-comparisons').querySelector('article')!;
    const trigger = within(record).getByRole('button', { name: 'Review details' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Route-window timing quantities details' });
    for (const label of ['Timing consistency', 'Observed within-allowance share', 'Observed p50', 'Observed p90']) {
      expect(within(dialog).getByRole('group', { name: label })).toBeInTheDocument();
    }
    expect(dialog).toHaveTextContent('Only supported route-window');
    expect(dialog).toHaveTextContent('3 samples · route allowance 35 min');
    expect(dialog).toHaveTextContent('Returned evidence');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
