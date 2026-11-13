import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DriveDynamicsSnapshot, MotorSnapshot } from '@/api/types';
import type { DataStateSource } from '@/api/dataState';
import type { DriveDetail, DriveTelemetryPoint, DrivingCoachData } from '@/types/driving';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { useUnits } from '@/hooks/useUnits';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import { forecastDepartures } from '../lib/departureForecast';
import { buildDestinationTransitions } from '../lib/destinationTransitions';
import { buildDriveDnaModel } from '../lib/driveDNA';
import { compareDrives, summarizeComparison } from '../lib/driveCompare';
import { DepartureForecastSectionBody } from './departure-forecast/DepartureForecastSectionBody';
import { DepartureForecastWeekdayRoutines } from './departure-forecast/DepartureForecastWeekdayRoutines';
import { DestinationTransitionEdgeList } from './destination-transitions/DestinationTransitionEdgeList';
import { DestinationTransitionsMethodology } from './destination-transitions/DestinationTransitionsMethodology';
import { DestinationTransitionsSectionBody } from './destination-transitions/DestinationTransitionsSectionBody';
import { LeadingSuccessorsDirectory } from './destination-transitions/LeadingSuccessorsDirectory';
import { AdvantageBreakdown } from './drive-compare/AdvantageBreakdown';
import { DriveIdentityCard } from './drive-compare/DriveIdentityCard';
import { DriveDnaEncodingLegend } from './drive-dna/DriveDnaEncodingLegend';
import { DriveDnaMethodologyCards } from './drive-dna/DriveDnaMethodologyCards';
import { DriveDnaSectionBody } from './drive-dna/DriveDnaSectionBody';
import DrivingTips from './driving-dynamics-modernization/DrivingTips';
import DrivingCoachSection from './driving-dynamics/DrivingCoachSection';
import GrokDynamicsBriefing from './driving-dynamics/GrokDynamicsBriefing';

const source = vi.hoisted(() => ({
  history: {} as DataStateSource<MotorSnapshot[]>,
  motor: {} as DataStateSource<MotorSnapshot>,
  dynamics: {} as DataStateSource<DriveDynamicsSnapshot>,
  coach: {} as DataStateSource<DrivingCoachData>,
  retry: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useVehicles')>(),
  useMotorHistory: () => ({ ...source.history, refetch: source.retry }),
  useMotorLatest: () => ({ ...source.motor, refetch: source.retry }),
  useDriveDynamicsLatest: () => ({ ...source.dynamics, refetch: source.retry }),
}));
vi.mock('@/api/hooks/useDriving', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useDriving')>(),
  useDrivingCoach: () => ({ ...source.coach, refetch: source.retry }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({
    locale: 'en-US', settings: {
      locale: 'en-US', decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
      unit_of_pressure: 'bar', chart_palette: 'cb_safe', tz_display_default: 'utc',
    },
  }),
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''),
      ),
  }),
}));

function rules(name: string): Rule[] {
  const result: Rule[] = [];
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', name), 'utf8'))
    .walkRules(rule => { result.push(rule); });
  return result;
}
const baseRules = rules('base.css');
const feedbackRules = rules('feedback.css');
const chartRules = rules('charts.css');
const packRules = new Map(PACK_IDS.map(pack => [pack, rules(join('packs', APP_DESIGN_PACK_FILES[pack]))] as const));
function selectors(rule: Rule): string[] {
  const parent = rule.parent;
  return parent?.type === 'rule'
    ? selectors(parent).flatMap(scope => rule.selectors.map(selector => selector.replaceAll('&', scope)))
    : rule.selectors;
}
function consumes(node: Element, sheet: readonly Rule[], selector: string, property: string) {
  return sheet.some(rule => rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === property)
    && selectors(rule).some(candidate => candidate.includes(selector) && node.matches(candidate)));
}
function assertNativeTrack(track: Element, pack: typeof PACK_IDS[number]) {
  const mode = APPLICATION_DESIGNS[pack].data;
  expect(consumes(track, feedbackRules, `[data-app-data="${mode}"]`, 'outline')).toBe(true);
  for (const fill of track.querySelectorAll('[data-metric-fill]')) {
    expect(consumes(fill, feedbackRules, '[data-metric-fill]', 'box-sizing')).toBe(true);
  }
  for (const node of [track, ...track.querySelectorAll('[data-metric-fill]')]) {
    for (const rule of [...baseRules, ...feedbackRules, ...packRules.get(pack)!]) {
      if (!selectors(rule).some(selector => node.matches(selector))) continue;
      for (const declaration of rule.nodes) {
        if (declaration.type !== 'decl') continue;
        expect(declaration.prop).not.toMatch(/^(width|height|inline-size|block-size|background|color|padding|border|border-radius)(-|$)/);
      }
    }
  }
}

function drive(id: number, from: string, to: string): DriveDetail {
  const startTs = `2026-08-${String(id).padStart(2, '0')}T10:00:00Z`;
  return {
    id, vehicleId: 7, startTs, endTs: startTs.replace('10:00', '10:30'),
    durationS: 1800, distanceM: 20_000, startAddress: from, endAddress: to,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 0, endBatteryPct: null, energyUsedWh: 3000, regenEnergyWh: 0,
    avgSpeedMps: 10, maxSpeedMps: 20, avgPowerW: 6000, outsideTempAvgC: null,
    insideTempAvgC: null, score: 75, endedStatus: 'completed', createdAt: startTs,
    updatedAt: startTs, telemetry: [], positions: [],
  };
}
const history = Array.from({ length: 8 }, (_, index) =>
  drive(index + 1, index % 2 ? 'A' : 'B', index % 2 ? 'B' : 'A'));
const now = Date.parse('2026-08-09T12:00:00Z');
const forecast = forecastDepartures([history[0]], now, 'UTC');
const transitions = buildDestinationTransitions(history, now, 'UTC');
function emission(timestamp: string, speed: number | null): DriveTelemetryPoint {
  return {
    timestamp, speed, power: 0, batteryLevel: null, outsideTemp: null, insideTemp: null,
    driverTemp: null, passengerTemp: null, elevation: null, idealRange: null,
    ratedRange: null, estRange: null, odometer: null, soc: null, usableSoc: null,
    tirePressureFl: null, tirePressureFr: null, tirePressureRl: null, tirePressureRr: null,
    isClimateOn: null, fanStatus: null, latitude: null, longitude: null,
  };
}
const dna = buildDriveDnaModel([
  emission('2026-08-01T10:00:00Z', 0), emission('2026-08-01T10:00:10Z', null),
]);
const queryReady = { isLoading: false, isResolved: true, error: null, refreshError: null, onRetry: source.retry };
const ready = { ...queryReady, vehicleSelected: true };
const dnaReady = { vehicleSelected: true, hasDrive: true, list: queryReady, telemetry: queryReady };
const compareReady = { isLoading: false, error: null, emptyMessage: null, onRetry: source.retry };
const comparisons = compareDrives(history[0], { ...history[1], score: null, energyUsedWh: 4000 });
const coach: DrivingCoachData = {
  overall_score: 75, total_drives_analyzed: 4, efficiency_wh_km: 150, best_efficiency_wh_km: 100,
  style_breakdown: { efficient: 2, moderate: 1, aggressive: 1 },
  patterns: { hard_accel_pct: 0, hard_brake_pct: null, highway_pct: 25, short_trip_pct: 50, cold_start_pct: 0 },
  weekly_trend: [], per_drive_scores: [],
  recommendations: [
    { category: 'power', impact: 'high', tip: 'Reported high-impact guidance' },
    { category: 'regen', impact: 'medium', tip: 'Reported medium-impact guidance' },
    { category: 'scope', impact: 'low', tip: 'Reported low-impact guidance' },
  ],
};
const styleCases: {
  name: string;
  total: number;
  counts: DrivingCoachData['style_breakdown'];
  widths: string[];
  labels: string[];
}[] = [
  { name: 'partial evidence', total: 20, counts: { efficient: 5, moderate: 0 }, widths: ['25%'], labels: ['5', '0', '—'] },
  { name: 'zero denominator', total: 0, counts: { efficient: 0, moderate: 0, aggressive: 0 }, widths: [], labels: ['0', '0', '0'] },
  { name: 'invalid denominator', total: NaN, counts: { efficient: 2, moderate: 1, aggressive: 1 }, widths: [], labels: ['2', '1', '1'] },
  { name: 'count above denominator', total: 4, counts: { efficient: 5, moderate: 1 }, widths: ['25%'], labels: ['5', '1', '—'] },
  { name: 'overfull distribution', total: 4, counts: { efficient: 4, moderate: 3, aggressive: 2 }, widths: ['100%', '75%', '50%'], labels: ['4', '3', '2'] },
  { name: 'invalid counts', total: 4, counts: { efficient: -1, moderate: 0.5, aggressive: NaN }, widths: [], labels: ['—', '—', '—'] },
  { name: 'missing counts', total: 4, counts: {}, widths: [], labels: ['—', '—', '—'] },
];
const motor: MotorSnapshot = {
  ts: history[0].startTs, created_at: history[0].startTs,
  torque_nm_front: -25, torque_nm_rear: 75, di_torque: null,
  motor_rpm_front: null, motor_rpm_rear: null, motor_temp_c_front: 0, motor_temp_c_rear: null,
  inverter_temp_c: null, inverter_temp_rear: null, heatsink_temp_front: null, heatsink_temp_rear: null,
  motor_current_front: null, motor_current_rear: null, state_front: null, state_rear: null,
  shift_state: 'D', vbat_front: null, vbat_rear: null, power_kw: 0, regen_kw: 0,
};

function mount(children: ReactNode) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}>{children}</QueryClientProvider></MemoryRouter>);
}
function Records() {
  const units = useUnits();
  return <>
    <DepartureForecastWeekdayRoutines forecast={forecast} state={ready} locale="en-US" timeZone="UTC" />
    <LeadingSuccessorsDirectory model={transitions} state={ready} locale="en-US" />
    {(['frequency', 'information'] as const).map(mode => <div key={mode} data-testid={`edges-${mode}`}>
      <DestinationTransitionEdgeList edges={transitions.edges} mode={mode} locale="en-US" />
    </div>)}
    <DestinationTransitionsMethodology model={transitions} locale="en-US" timeZone="UTC" />
    <DriveIdentityCard side="a" drive={history[0]} state={compareReady} />
    <AdvantageBreakdown rows={comparisons} summary={summarizeComparison(comparisons)} state={compareReady} />
    <DriveDnaEncodingLegend model={dna} state={dnaReady} units={units} />
    <div data-testid="dna-method"><DriveDnaMethodologyCards /></div>
    <div data-testid="measured-tips"><DrivingTips vehicleId={7} /></div>
    <GrokDynamicsBriefing vehicleId={7} />
    <DrivingCoachSection vehicleId="7" showPerDriveScores={false} />
    <div data-testid="departure-passive"><DepartureForecastSectionBody
      forecast={forecast} state={{ ...ready, vehicleSelected: false }}>Hidden departure</DepartureForecastSectionBody></div>
    <div data-testid="destination-passive"><DestinationTransitionsSectionBody
      model={transitions} state={{ ...ready, vehicleSelected: false }}>Hidden destination</DestinationTransitionsSectionBody></div>
    <div data-testid="dna-passive"><DriveDnaSectionBody state={{ ...dnaReady, vehicleSelected: false }}
      validRows={2} returnedRows={2}>Hidden DNA</DriveDnaSectionBody></div>
  </>;
}
beforeEach(() => {
  source.history = { data: [motor], isSuccess: true };
  source.motor = { data: motor, isSuccess: true };
  source.dynamics = { data: { lateral_acceleration: -0.3, longitudinal_acceleration: 0.4 }, isSuccess: true };
  source.coach = { data: coach, isSuccess: true };
  source.retry.mockClear();
});

describe('driving-02 native adoption (source-only)', () => {
  it.each(PACK_IDS)('%s binds actual frames, readouts, records and passive guidance to existing CSS consumers', pack => {
    const bytes = JSON.stringify({ history, forecast, transitions, dna, motor, coach });
    const { container } = mount(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}><Records /></div>);
    const release = observeAppDesignScopes(container.querySelector('[data-app-design-preview]')!);
    try {
      const design = APPLICATION_DESIGNS[pack];
      const cards = [
        ...screen.getByTestId('departure-weekday-routines').querySelectorAll('li'),
        ...screen.getByTestId('destination-leading-directory').querySelectorAll('article'),
        ...screen.getByTestId('destination-methodology').querySelectorAll('article'),
        ...screen.getByTestId('edges-frequency').querySelectorAll('article'),
        ...screen.getByTestId('edges-information').querySelectorAll('article'),
        ...screen.getByTestId('drive-dna-encoding').querySelectorAll('[data-app-part~="card"]'),
        ...screen.getByTestId('dna-method').querySelectorAll('[data-app-part~="card"]'),
      ];
      expect(cards).toHaveLength(7 + 2 + 9 + 2 * transitions.edges.length + 5 + 2);
      for (const card of cards) {
        expect(card).toHaveAttribute('data-surface-variant', 'standalone');
        expect(consumes(card, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
        expect(consumes(card, packRules.get(pack)!, '[data-app-part~="card"]', pack === 'editorial' ? 'border-block' : 'border')).toBe(true);
      }
      const origins = screen.getByTestId('destination-leading-directory').querySelectorAll('article');
      for (const origin of origins) {
        const tiles = origin.querySelectorAll('[data-app-metric="tile"]');
        expect(tiles).toHaveLength(8);
        for (const tile of tiles) {
          expect(consumes(tile, feedbackRules, `[data-app-data="${design.data}"]`, 'padding')).toBe(true);
          expect(tile.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
          expect(consumes(tile.querySelector('[data-app-part~="metric-reading"]')!,
            feedbackRules, '[data-app-part~="metric-value"]', 'font-variant-numeric')).toBe(true);
        }
      }
      for (const [id, count] of [['drive-compare-identity-a', 4], ['drive-compare-breakdown', 3]] as const) {
        const rows = screen.getByTestId(id).querySelectorAll('[data-app-list="definitions"] > [data-app-part~="list-row"]');
        expect(rows).toHaveLength(count);
        for (const row of rows) {
          expect(consumes(row, feedbackRules, `[data-app-data="${design.data}"]`, 'display')).toBe(true);
          expect(row.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
          expect(row.querySelector('[data-app-part~="metric-value"]')).not.toBeEmptyDOMElement();
        }
      }
      for (const id of ['departure-passive', 'destination-passive', 'dna-passive']) {
        const gate = screen.getByTestId(id);
        const notice = gate.querySelector('[data-app-feedback-kind="notice"]')!;
        expect(consumes(notice, feedbackRules, `[data-app-feedback="${design.feedback}"]`, 'display')).toBe(true);
        expect(notice.querySelector('[data-app-part~="feedback-icon"]')).toHaveAttribute('aria-hidden', 'true');
        expect(notice.querySelector('[data-app-part~="feedback-content"] > [data-app-part~="feedback-message"]'))
          .toHaveTextContent('Select a vehicle');
        expect(gate.querySelector('[role], [aria-live], button')).toBeNull();
      }
      const tips = screen.getByTestId('measured-tips').querySelectorAll('li');
      expect(tips).toHaveLength(4);
      const findings = screen.getByTestId('grok-dynamics-briefing').querySelectorAll('[data-finding]');
      expect(findings.length).toBeGreaterThan(0);
      const recommendations = coach.recommendations.map(rec => screen.getByText(rec.tip).parentElement!);
      for (const record of [...tips, ...findings, ...recommendations]) {
        expect(record).toHaveAttribute('data-app-feedback-kind', 'insight');
        expect(consumes(record, feedbackRules, `[data-app-feedback="${design.feedback}"]`, 'padding')).toBe(true);
        expect(record.querySelector('[data-app-part~="feedback-message"]')).not.toBeEmptyDOMElement();
        expect(record).not.toHaveAttribute('role');
      }
      recommendations.forEach((record, index) => {
        expect(record.querySelector('[data-app-part~="badge"]')).toHaveAttribute('data-app-variant', ['danger', 'warning', 'success'][index]);
      });
      expect(screen.queryByText('Per-Drive Scores')).not.toBeInTheDocument();
      const stylePanel = screen.getByText('Style Breakdown').parentElement!;
      const styleTrack = stylePanel.querySelector('[data-metric-track]')!;
      assertNativeTrack(styleTrack, pack);
      expect(styleTrack).toHaveClass('flex', 'h-4', 'rounded-full', 'overflow-hidden', 'mb-4');
      expect(styleTrack).not.toHaveAttribute('role');
      const segments = styleTrack.querySelectorAll('[data-metric-fill]');
      expect(segments).toHaveLength(3);
      for (const [index, segment] of [...segments].entries()) {
        expect(segment).toHaveStyle({ width: ['50%', '25%', '25%'][index] });
        expect(segment).toHaveClass('shrink-0', [
          'bg-[var(--semantic-success)]', 'bg-[var(--semantic-warning)]', 'bg-[var(--semantic-danger)]',
        ][index]);
      }
      const styleLegend = stylePanel.querySelector('[data-app-part~="chart-legend"]')!;
      const legendProperty = {
        precision: 'border-block-start', editorial: 'border-block-start',
        instrument: 'border-block', geometric: 'border-block', soft: 'background',
      }[design.chart];
      expect(consumes(styleLegend, chartRules, `[data-app-design-owner~="chart-${design.chart}"]`, legendProperty)).toBe(true);
      expect(consumes(styleLegend, chartRules, '[data-app-part~="chart-legend"]', 'line-height')).toBe(true);
      expect([...styleLegend.querySelectorAll('[data-chart-legend-label]')].map(label => label.textContent))
        .toEqual(['efficient', 'moderate', 'aggressive']);
      expect([...styleLegend.querySelectorAll('[data-app-part~="metric-value"]')].map(value => value.textContent))
        .toEqual(['2', '1', '1']);
      const patternsPanel = screen.getByText('Driving Patterns').parentElement!;
      const patternRows = patternsPanel.querySelectorAll('[data-app-metric="bar"]');
      expect(patternRows).toHaveLength(5);
      for (const [index, row] of [...patternRows].entries()) {
        expect(row.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
        const track = row.querySelector('[data-metric-track]');
        if (index === 1) {
          expect(track).toBeNull();
          expect(row.querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('—');
        } else {
          expect(track).toHaveClass('h-1.5', 'rounded-full', 'bg-[var(--surface-3)]', 'overflow-hidden');
          assertNativeTrack(track!, pack);
          expect(track!.querySelector('[data-metric-fill]')).toHaveStyle({ width: ['0%', '', '25%', '50%', '0%'][index] });
          expect(track!.querySelector('[data-metric-fill]')).toHaveClass('bg-[var(--theme-primary)]');
        }
        expect(row.querySelector('[role], [aria-valuenow], [aria-live]')).toBeNull();
      }
      expect(screen.getByRole('progressbar', { name: 'Rear axle share' })).toHaveAttribute('aria-valuenow', '75');
      expect(within(screen.getByTestId('drive-compare-identity-a')).getByText('0.00% → —')).toBeInTheDocument();
      expect(within(screen.getByTestId('drive-compare-breakdown')).getByText('Not comparable')).toBeInTheDocument();
      expect(within(screen.getByTestId('drive-compare-breakdown')).getByText('Even')).toBeInTheDocument();
      expect(within(screen.getByTestId('drive-compare-breakdown')).getByText('Drive A')).toBeInTheDocument();
      expect(within(screen.getByTestId('departure-weekday-routines')).getAllByText('Unsupported')).toHaveLength(6);
      expect(within(screen.getByTestId('drive-dna-encoding')).getByText('Partial')).toBeInTheDocument();
      expect(within(screen.getByTestId('drive-dna-encoding')).getAllByText('Unavailable')).toHaveLength(2);
      expect(JSON.stringify({ history, forecast, transitions, dna, motor, coach })).toBe(bytes);
    } finally { release(); }
  });

  it('keeps passive departure states distinct and never introduces a live status or local retry', () => {
    const empty = forecastDepartures([], now, 'UTC');
    const view = mount(<DepartureForecastSectionBody forecast={empty} state={{ ...ready, isResolved: false, isRefreshBlocked: true }}>Evidence</DepartureForecastSectionBody>);
    expect(screen.getByText(/loading is paused. No data has been loaded yet/)).toBeInTheDocument();
    view.rerender(<DepartureForecastSectionBody forecast={empty} state={ready}>Evidence</DepartureForecastSectionBody>);
    expect(screen.getByText('No drives were returned, so there is no learned departure pattern.')).toBeInTheDocument();
    view.rerender(<DepartureForecastSectionBody forecast={empty} state={ready} allowEmpty>Evidence</DepartureForecastSectionBody>);
    expect(screen.getByText('Evidence')).toBeInTheDocument();
    expect(view.container.querySelector('[role], [aria-live], button')).toBeNull();
  });

  it('keeps visits, continuity and origin requirements separate in passive destination guidance', () => {
    const single = buildDestinationTransitions([history[0]], now, 'UTC');
    const content = (requirement: 'visits' | 'transitions') => <DestinationTransitionsSectionBody
      model={single} state={ready} requirement={requirement}>Visit evidence</DestinationTransitionsSectionBody>;
    const view = mount(content('transitions'));
    expect(screen.getByText(/no adjacent returned pair passed endpoint continuity/)).toBeInTheDocument();
    view.rerender(content('visits'));
    expect(screen.getByText('Visit evidence')).toBeInTheDocument();
    expect(view.container.querySelector('[role], [aria-live], button')).toBeNull();
  });

  it('preserves invalid-only versus absent DNA telemetry and minimum/zero-row exceptions', () => {
    const content = (validRows: number, returnedRows: number, allowZeroRows = false) => <DriveDnaSectionBody
      state={dnaReady} validRows={validRows} returnedRows={returnedRows} minimumRows={2} allowZeroRows={allowZeroRows}>DNA evidence</DriveDnaSectionBody>;
    const view = mount(content(0, 3));
    expect(screen.getByText('Telemetry rows were returned, but none had a valid timestamp.')).toBeInTheDocument();
    view.rerender(content(0, 0));
    expect(screen.getByText('This drive returned no telemetry emissions.')).toBeInTheDocument();
    view.rerender(content(1, 1));
    expect(screen.getByText(/One chronological emission is available/)).toBeInTheDocument();
    view.rerender(content(0, 0, true));
    expect(screen.getByText('DNA evidence')).toBeInTheDocument();
    expect(view.container.querySelector('[role], [aria-live], button')).toBeNull();
  });

  it.each([-4, 0, 0.125, 100, 140, null, undefined, NaN, Infinity])(
    'keeps the original finite-only pattern tracks and raw readouts for %s',
    value => {
      source.coach = { data: {
        ...coach,
        patterns: Object.assign({}, coach.patterns, {
          hard_accel_pct: value, hard_brake_pct: value, highway_pct: value,
          short_trip_pct: value, cold_start_pct: value,
        }),
      }, isSuccess: true };
      mount(<DrivingCoachSection vehicleId="7" showPerDriveScores={false} />);
      const rows = screen.getByText('Driving Patterns').parentElement!.querySelectorAll('[data-app-metric="bar"]');
      expect(rows).toHaveLength(5);
      for (const row of rows) {
        const track = row.querySelector('[data-metric-track]');
        if (typeof value === 'number' && Number.isFinite(value)) {
          expect(track).toHaveClass('h-1.5', 'rounded-full', 'overflow-hidden');
          expect(track!.querySelector('[data-metric-fill]')).toHaveStyle({ width: `${Math.max(0, Math.min(100, value))}%` });
          expect(row.querySelector('[data-app-part~="metric-value"]')).toHaveTextContent(`${value.toFixed(2)}%`);
        } else {
          expect(track).toBeNull();
          expect(row.querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('—');
        }
        expect(row.querySelector('[role], [aria-valuenow], [aria-live]')).toBeNull();
      }
    },
  );

  it.each(styleCases)('does not renormalize the style distribution or fabricate categories for $name', ({ total, counts, widths, labels }) => {
    source.coach = { data: { ...coach, total_drives_analyzed: total, style_breakdown: counts }, isSuccess: true };
    const bytes = JSON.stringify(source.coach.data);
    mount(<DrivingCoachSection vehicleId="7" showPerDriveScores={false} />);
    const panel = screen.getByText('Style Breakdown').parentElement!;
    const track = panel.querySelector('[data-metric-track]')!;
    expect(track).toHaveClass('flex', 'h-4', 'overflow-hidden');
    expect([...track.querySelectorAll<HTMLElement>('[data-metric-fill]')].map(fill => fill.style.width)).toEqual(widths);
    expect([...panel.querySelectorAll('[data-app-part~="metric-value"]')].map(value => value.textContent)).toEqual(labels);
    expect(panel.querySelectorAll('[data-chart-legend-label]')).toHaveLength(3);
    expect(track.querySelector('[role], [aria-valuenow], [aria-live]')).toBeNull();
    expect(track).not.toHaveAttribute('role');
    expect(JSON.stringify(source.coach.data)).toBe(bytes);
  });

  it('keeps native quantitative consumers neutral outside complete profiles and under nested widget-only boundaries', async () => {
    const view = mount(<div data-app-design-preview="" {...getAppDesignAttributes('terminal')}>
      <div data-app-design-preview="" data-testid="neutral">
        <DrivingCoachSection vehicleId="7" showPerDriveScores={false} />
      </div>
    </div>);
    const host = view.container.querySelector('[data-app-design-preview]')!;
    const neutral = screen.getByTestId('neutral');
    const release = observeAppDesignScopes(host);
    try {
      const tracks = [...neutral.querySelectorAll('[data-metric-track]')];
      expect(tracks).toHaveLength(5);
      const originalStyles = tracks.map(track => track.outerHTML);
      for (const track of tracks) {
        expect(track).not.toHaveAttribute('data-app-design-owner');
        expect(consumes(track, feedbackRules, '[data-metric-track]', 'outline')).toBe(false);
      }
      for (const [name, value] of Object.entries(getAppDesignAttributes('v2'))) neutral.setAttribute(name, value);
      await waitFor(() => expect(tracks[0]).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-v2')));
      for (const track of tracks) {
        assertNativeTrack(track, 'v2');
        expect(consumes(track, feedbackRules, '[data-app-data="ledger"]', 'outline')).toBe(false);
      }
      neutral.removeAttribute('data-app-data');
      await waitFor(() => expect(tracks[0]).not.toHaveAttribute('data-app-design-owner'));
      expect(tracks.map(track => track.outerHTML)).toEqual(originalStyles);
      view.rerender(<DrivingCoachSection vehicleId="7" showPerDriveScores={false} />);
      await waitFor(() => expect(view.container.querySelector('[data-app-design-owner]')).toBeNull());
      for (const track of view.container.querySelectorAll('[data-metric-track]')) {
        expect(consumes(track, feedbackRules, '[data-metric-track]', 'outline')).toBe(false);
      }
    } finally { release(); }
  });

  it('retains the original native evidence after refresh failure, without creating bars before the first result', () => {
    source.coach = { data: coach, isError: true, error: new Error('Coach refresh failed'), dataUpdatedAt: 123 };
    const content = () => <DrivingCoachSection vehicleId="7" showPerDriveScores={false} />;
    const view = mount(content());
    expect(view.container.querySelectorAll('[data-metric-track]')).toHaveLength(5);
    expect(screen.getByText('Reported high-impact guidance')).toBeInTheDocument();
    expect(screen.queryByText('Per-Drive Scores')).not.toBeInTheDocument();
    source.coach = { fetchStatus: 'paused' };
    view.rerender(content());
    expect(view.container.querySelector('[data-metric-track]')).toBeNull();
    expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
    expect(screen.queryByText('No driving-pattern evidence available.')).not.toBeInTheDocument();
  });
});
