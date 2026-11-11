import type { ComponentType } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExclusiveReport } from '@/types/teslaPhysics';
import { formatDistance } from '@/lib/unitConversion';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { usePhysicsPage, type PhysicsPage } from './PhysicsPageShell';
import PhysicsContradictionsSection from './PhysicsContradictionsSection';
import PhysicsFirmwareEpochsSection from './PhysicsFirmwareEpochsSection';
import PhysicsLifeTapeSection from './PhysicsLifeTapeSection';
import PhysicsMetersSection from './PhysicsMetersSection';
import PhysicsModesSection from './PhysicsModesSection';
import PhysicsRangeSection from './PhysicsRangeSection';
import PhysicsUnknownSection from './PhysicsUnknownSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
    typeof fallback === 'string' ? fallback.replace(/{{(\w+)}}/g, (match, name: string) => String(options?.[name] ?? match)) : key }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 1 }) }));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({
  locale: 'en-US', decimals: 2, density: 'comfortable', settings: {
    unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar', decimal_precision: 2,
    locale: 'en-US', tz_display_default: 'utc', timezone_user: 'UTC',
  },
}) }));
vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useTeslaExclusive: () => ({
    data: report, isSuccess: true, isPending: false, isLoading: false, isFetching: false,
    error: null, isError: false, dataUpdatedAt: 1, fetchStatus: 'idle', refetch: vi.fn(),
  }),
}));

const start = '2026-03-01T11:00:00Z';
const end = '2026-03-01T12:00:00Z';
function makeReport() {
  return {
    life_tape: { vehicle_id: 1, from: start, to: end, honesty: 'Returned intervals only.', segments: [
      { state: 'unknown', started_at: start, ended_at: end, duration_s: 0 },
      { state: 'charging', started_at: start, ended_at: end, duration_s: 300 },
    ] },
    contradictions: { vehicle_id: 1, honesty: 'No causal conclusion.', findings: [
      { at: start, kind: 'older', detail: 'Earlier finding.', unknown: false },
      { at: end, kind: 'latest', detail: 'Latest detail.', observations: 0, unknown: true },
    ] },
    meters: { vehicle_id: 1, honesty: 'Counters only.', odometer_m: 0, driving_distance_m: null, fsd_distance_m: 0, resets: [
      { at: start, meter: 'old', from_m: null, to_m: 0, cause: 'Unknown before value', unknown: true },
      { at: end, meter: 'new', from_m: 1000, to_m: 0, cause: 'Nearby firmware, not proof', unknown: false },
    ] },
    firmware_epochs: { vehicle_id: 1, honesty: 'Not installation times.', epochs: [
      { version: '2026.first', started_at: start, ended_at: end, fsd_meter_start_m: null, fsd_meter_end_m: 0, complete_to_unplug_s: null, honesty: 'Keep first context.' },
      { version: '2026.latest', started_at: end, ended_at: null, fsd_meter_start_m: 0, fsd_meter_end_m: 0, complete_to_unplug_s: 0, honesty: 'Keep latest context.' },
    ] },
    unknown_os: { vehicle_id: 1, honesty: 'Unknown is not zero.', window_hours: 1, sample_hours: null, unknown_hours: null,
      budgets: [{ kind: 'zero', hours: 0, unknown: false }, { kind: 'gap', hours: 1, unknown: true }] },
    modes: { vehicle_id: 1, honesty: 'Flags are observations.', valet: false, service: null, transport: false,
      allowed: ['Returned interpretation.'], forbidden: [] },
    range: { vehicle_id: 1, honesty: 'No true range.', rated_range_m: 0, est_range_m: 1000, ideal_range_m: null,
      energy_remaining_wh: null, recent_wh_per_km: null, disagree: true, true_range_m: null },
  } satisfies Pick<ExclusiveReport, 'life_tape' | 'contradictions' | 'meters' | 'firmware_epochs' | 'unknown_os' | 'modes' | 'range'>;
}
let report = makeReport();
beforeEach(() => {
  report = makeReport();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

function Investigation({ component: Component }: { component: ComponentType<{ physics: PhysicsPage }> }) {
  const physics = usePhysicsPage();
  return <Component physics={physics} />;
}
function mount(component: ComponentType<{ physics: PhysicsPage }>) {
  return render(<MemoryRouter><Investigation component={component} /></MemoryRouter>);
}
function records(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-app-record-kind="physics-evidence"]')];
}
const km = (value: number) => formatDistance(value, {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
  energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
});

describe('Physics native evidence records', () => {
  it('binds real records and their reading/context/body slots to deliberate CSS consumers in all 27 profiles, and releases off state', () => {
    const nativeSelectors: string[] = [];
    const metricSelectors: string[] = [];
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
      .walkRules(rule => {
        nativeSelectors.push(...rule.selectors.filter(selector =>
          selector.includes('data-app-record-kind="physics-') && selector.includes('data-app-design-owner')));
        metricSelectors.push(...rule.selectors.filter(selector =>
          selector.includes('data-app-metric=') && selector.includes('data-app-design-owner')));
      });
    const view = render(<MemoryRouter><section data-app-design-preview {...getAppDesignAttributes('classic')}>
      <Investigation component={PhysicsLifeTapeSection} />
      <Investigation component={PhysicsContradictionsSection} />
      <Investigation component={PhysicsMetersSection} />
      <Investigation component={PhysicsUnknownSection} />
      <Investigation component={PhysicsFirmwareEpochsSection} />
      <Investigation component={PhysicsModesSection} />
      <Investigation component={PhysicsRangeSection} />
    </section></MemoryRouter>);
    const host = view.container.querySelector('[data-app-design-preview]')!;
    const cards = [...host.querySelectorAll('[data-app-record-kind^="physics-"]')];
    const metrics = [...host.querySelectorAll('[data-app-part~="card"][data-app-part~="metric"]')];
    const originalContent = cards.map(card => card.textContent);
    const originalReadings = metrics.map(metric => metric.textContent);
    const release = observeAppDesignScopes(host);
    try {
      for (const pack of Object.keys(APPLICATION_DESIGNS) as Array<keyof typeof APPLICATION_DESIGNS>) {
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
        const refresh = observeAppDesignScopes(host);
        try {
          const selectors = nativeSelectors.filter(selector => selector.includes(`[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`));
          for (const card of cards) {
            expect(selectors.some(selector => card.matches(selector))).toBe(true);
            for (const slot of card.querySelectorAll('[data-app-record-slot]')) {
              expect(selectors.some(selector => slot.matches(selector))).toBe(true);
            }
          }
          const readings = metricSelectors.filter(selector => selector.includes(`[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`));
          expect(metrics).toHaveLength(6);
          expect(metrics.every(metric => readings.some(selector => metric.matches(selector)))).toBe(true);
          expect(cards.map(card => card.textContent)).toEqual(originalContent);
          expect(metrics.map(metric => metric.textContent)).toEqual(originalReadings);
        } finally { refresh(); }
      }
      for (const name of Object.keys(getAppDesignAttributes('classic'))) host.removeAttribute(name);
      const refresh = observeAppDesignScopes(host);
      try {
        for (const card of cards) {
          expect(card).not.toHaveAttribute('data-app-design-owner');
          expect(nativeSelectors.some(selector => card.matches(selector))).toBe(false);
        }
        for (const metric of metrics) {
          expect(metric).not.toHaveAttribute('data-app-design-owner');
          expect(metricSelectors.some(selector => metric.matches(selector))).toBe(false);
        }
      } finally { refresh(); }
    } finally { release(); }
  });

  it('owns state durations and interval context without treating an unknown zero interval as absent', () => {
    const { container } = mount(PhysicsLifeTapeSection);
    const cards = [...container.querySelectorAll('[data-app-metric="card"]')];
    expect(cards.map(card => card.querySelector('[data-app-part="metric-label"]')?.textContent)).toEqual(['charging', 'unknown']);
    expect(cards[1].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('0.00 s · 0.00%');
    expect(cards[1].querySelector('[data-app-part="metric-context"]')).toHaveTextContent('1 returned intervals');
    expect(cards[1].querySelector('[data-app-part~="badge"]')).toHaveAttribute('data-app-variant', 'warning');
  });

  it('keeps latest matching contradictions, zero observation counts and unknown nearby-port context', () => {
    const { container } = mount(PhysicsContradictionsSection);
    const [latest] = records(container);
    expect(latest).toHaveAttribute('data-app-part', 'card');
    expect(latest.querySelector('[data-app-record-slot="reading"]')).toHaveTextContent('latest · 0 observed readings');
    expect(latest.querySelectorAll('[data-app-record-slot="context"]')).toHaveLength(3);
    expect(latest).toHaveTextContent('state unknown · latch unknown · gear unknown');
    expect(latest).toHaveTextContent('Proximity is context, not a synchronous reading or proof');
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by finding' }), { target: { value: 'older' } });
    expect(records(container)[0]).toHaveTextContent('Earlier finding.');
  });

  it('preserves reset reverse order, original firmware order, SI formatting, null bounds and causal cautions', () => {
    const { container } = mount(PhysicsMetersSection);
    const evidence = records(container);
    expect(evidence).toHaveLength(4);
    expect(evidence[0].querySelector('[data-app-record-slot="reading"]')).toHaveTextContent(`new: ${km(1000)} → ${km(0)}`);
    expect(evidence[1].querySelector('[data-app-record-slot="reading"]')).toHaveTextContent(`old: unknown → ${km(0)}`);
    expect(evidence[1].querySelector('[data-app-record-slot="context"]')).toHaveTextContent('Unknown before value · unknown');
    expect(evidence.slice(2).map(card => card.querySelector('[data-app-record-slot="reading"]')?.textContent))
      .toEqual([expect.stringContaining('2026.first'), expect.stringContaining('2026.latest')]);
    expect(evidence[2].querySelector('[data-app-record-slot="context"]')).toHaveTextContent(`unknown → ${km(0)}`);
  });

  it('retains firmware latest-observed, null versus zero dwell and per-record honesty', () => {
    const { container } = mount(PhysicsFirmwareEpochsSection);
    const evidence = records(container);
    expect(evidence[0]).toHaveTextContent('2026.first');
    expect(evidence[0]).toHaveTextContent('complete → unplug: unknown');
    expect(evidence[1].querySelector('[data-app-record-slot="reading"]')).toHaveTextContent('Latest observed version');
    expect(evidence[1]).toHaveTextContent('complete → unplug: 0.00 s');
    expect(evidence[1].querySelectorAll('[data-app-record-slot="context"]')[1]).toHaveTextContent('Keep latest context.');
  });

  it('owns sorted unknown budgets with their source flags and requested-window context', () => {
    const { container } = mount(PhysicsUnknownSection);
    const cards = [...container.querySelectorAll('[data-app-metric="card"]')];
    expect(cards.map(card => card.querySelector('[data-app-part="metric-label"]')?.textContent)).toEqual(['gap', 'zero']);
    expect(cards[0].querySelector('[data-app-part="metric-context"]')).toHaveTextContent('100.00% of requested window');
    expect(cards[1].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('0.00 h');
    expect(cards[1]).toHaveTextContent('No unknown flag reported for this budget');
  });

  it('owns both interpretation surfaces, keeping the real rule and missing-rule explanation separate', () => {
    const { container } = mount(PhysicsModesSection);
    const interpretations = [...container.querySelectorAll('[data-app-record-kind="physics-interpretation"]')];
    expect(interpretations.map(card => card.querySelector('[data-app-record-slot="label"]')?.textContent)).toEqual(['Allowed', 'Forbidden']);
    expect(interpretations[0].querySelector('[data-app-record-slot="body"]')).toHaveTextContent('Returned interpretation.');
    expect(interpretations[1].querySelector('[data-app-record-slot="body"]')).toHaveTextContent('No forbidden interpretations returned.');
  });

  it('keeps zero range, excludes the missing estimate, and never derives a true range', () => {
    const { container } = mount(PhysicsRangeSection);
    const known = [...container.querySelectorAll('[data-app-part~="card"][data-app-metric="brief"]')];
    expect(known.map(card => card.querySelector('[data-app-part="metric-label"]')?.textContent)).toEqual(['Rated', 'Typical']);
    expect(known[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent(km(0));
    const [pair] = records(container);
    expect(pair.querySelector('[data-app-record-slot="reading"]')).toHaveTextContent(`Rated vs Typical: ${km(1000)} apart`);
    expect(pair.querySelectorAll('[data-app-record-slot="context"]')[1]).toHaveTextContent('Difference relative to Rated: unknown');
    expect(screen.queryByText('true_range must stay empty')).toBeNull();
    for (const card of [...known, pair]) expect(card.querySelector('[data-metric-track], [data-metric-fill]')).toBeNull();
  });

  it('keeps empty-array explanations without inventing returned records', () => {
    report.range.est_range_m = 0;
    const view = mount(PhysicsRangeSection);
    expect(within(records(view.container)[0]).getByText('Rated and Typical are equal in the returned estimates')).toBeInTheDocument();
    view.unmount();
    report.meters.resets = [];
    report.firmware_epochs.epochs = [];
    const empty = mount(PhysicsMetersSection);
    expect(records(empty.container)).toHaveLength(0);
    expect(screen.getByText(/No meter drops were returned in this bounded window/)).toBeInTheDocument();
    expect(screen.getByText('No firmware counter bounds were returned for cross-checking.')).toBeInTheDocument();
  });
});
