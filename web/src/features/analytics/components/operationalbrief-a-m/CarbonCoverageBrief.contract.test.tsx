import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { buildCarbonIntelligence } from '../../lib/carbonIntelligence';
import { carbonQueryState, type CarbonQueryLike } from '../carbon-intelligence/queryState';
import type { CarbonDisplay, CarbonQueryState } from '../carbon-intelligence/types';
import { CarbonCoverageBrief } from './CarbonCoverageBrief';

// Keep the real analysis, raw bridge, OperationalBrief and source-state UI mounted.
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C',
    pressure: 'kPa', energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US' } }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });
const number = (raw: number | null | undefined) => raw == null ? '—' : raw.toFixed(2);
const display: CarbonDisplay = {
  energyUnit: 'kWh', energyValue: raw => raw / 1000,
  formatEnergy: number, formatDistance: number, formatKg: number, formatSignedKg: number,
  formatIntensity: number, formatPercent: number, formatNumber: vi.fn(number),
  formatHour: raw => raw == null ? '—' : `${String(raw).padStart(2, '0')}:00`,
  formatMonth: raw => raw,
};
const labels = ['Rows returned', 'Valid unique hours', 'Invalid hour rows',
  'Invalid intensity rows', 'Duplicate hour rows'];
const contexts = ['24 expected clock-hours', 'Canonical rows used in analysis',
  'Required integer 0–23', 'Required finite non-negative value',
  'First valid row retained deterministically'];
const zeroCounts = [0, 0, 0, 0, 0];
const unknownCounts = [null, null, null, null, null];
const mixedCurve = [
  { hour_of_day: 0, g_co2_per_kwh: 0 },
  { hour_of_day: 1, g_co2_per_kwh: 100 },
  { hour_of_day: 0, g_co2_per_kwh: 999 },
  { hour_of_day: 24, g_co2_per_kwh: 10 },
  { hour_of_day: 2, g_co2_per_kwh: -1 },
  null,
];

function show(intensity: unknown, overrides: Partial<CarbonQueryLike> = {},
  enabled = true, formatting = display) {
  const analysis = buildCarbonIntelligence({
    intensity, periodSummary: undefined, lifetimeSummary: undefined, recommendation: undefined,
    window: { startLabel: '2026-01-01', endLabel: '2026-06-30',
      startInstant: '2026-01-01T00:00:00Z', endInstantExclusive: '2026-07-01T00:00:00Z', timezone: 'UTC' },
  });
  const originalAnalysis = JSON.stringify(analysis);
  const onRetry = vi.fn();
  const state: CarbonQueryState = carbonQueryState({ data: intensity, isLoading: false,
    isPending: false, isSuccess: true, isError: false, error: null, isFetching: false,
    fetchStatus: 'idle', ...overrides }, enabled, onRetry);
  const view = render(<MemoryRouter><CarbonCoverageBrief analysis={analysis} display={formatting}
    states={{ intensity: state, period: state, lifetime: state, recommendation: state }} /></MemoryRouter>);
  const band = screen.getByTestId('carbon-curve-coverage');
  expect(within(band).getByRole('heading', { name: 'Curve source accounting and completeness' })).toBeInTheDocument();
  assertOperationalBriefDisclosure(band, 'Built-in, admin-editable static 24-hour model', { allMatches: true, region: 'drawer' });
  expect(within(band).getByRole('button', { name: 'Review details' })).toBeEnabled();
  expect(band.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
  return { ...view, band, state, analysis, originalAnalysis, onRetry };
}

function expectCounts(band: HTMLElement, expected: readonly (number | null)[], loading = false) {
  const calls = vi.mocked(useOperationalMetrics).mock.calls;
  const metrics = calls[calls.length - 1]?.[0];
  expect(metrics?.map(metric => ({ id: metric.metricId, occurrence: metric.occurrenceId, raw: metric.rawValue })))
    .toEqual(expected.map((raw, index) => ({ id: 'count', occurrence: `carbon-coverage-${index}`, raw })));
  expected.forEach((raw, index) => {
    const cell = band.querySelector(`[data-operational-metric="carbon-coverage-${index}"]`);
    expect(cell).toHaveAttribute('data-value-state', raw == null ? 'missing' : 'value');
    if (!(cell instanceof HTMLElement)) throw new Error(`Missing coverage cell ${index}`);
    expect(within(cell).getByText(labels[index])).toBeInTheDocument();
    expect(within(cell).getByText(contexts[index])).toBeInTheDocument();
    if (loading) {
      expect(cell.querySelector('[data-operational-value]')).toBeNull();
      expect(cell.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    } else {
      expect(cell.querySelector('[data-operational-value]')).toHaveTextContent(number(raw));
    }
  });
}

function expectUnchanged(view: ReturnType<typeof show>) {
  expect(JSON.stringify(view.analysis)).toBe(view.originalAnalysis);
}

describe('CarbonCoverageBrief rendered accounting contract', () => {
  it.each([
    { caseId: 'null curve', input: { curve: null } },
    { caseId: 'missing curve', input: {} },
    { caseId: 'object curve', input: { curve: { hour_of_day: 0, g_co2_per_kwh: 0 } } },
    { caseId: 'string curve', input: { curve: 'not-an-array' } },
    { caseId: 'null payload', input: null },
  ])('keeps all five raw counts unknown for $caseId despite returned query data', ({ input }) => {
    const view = show(input);
    expect(view.state.hasData).toBe(true);
    expect(view.analysis.curve.source.payloadPresent).toBe(false);
    expectCounts(view.band, unknownCounts);
    expect(display.formatNumber).not.toHaveBeenCalled();
    assertOperationalBriefDisclosure(view.band, 'Returned evidence');
    expect(view.band.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(within(view.band).getByText('Unknown')).toBeInTheDocument();
    expect(within(view.band).queryByText(/Missing backend\/model clock-hours:/)).not.toBeInTheDocument();
    expectUnchanged(view);
  });

  it('emits five authoritative measured zeros for an empty curve array', () => {
    const view = show({ curve: [] });
    expect(view.analysis.curve.source.payloadPresent).toBe(true);
    expectCounts(view.band, zeroCounts);
    assertOperationalBriefDisclosure(view.band, 'Returned evidence');
    expect(within(view.band).getByText(/Missing backend\/model clock-hours: 00:00, 01:00/)).toBeInTheDocument();
    expectUnchanged(view);
  });

  it('preserves exact invalid and incomplete row counts with zero intensity and first-valid duplicates', () => {
    const view = show({ curve: mixedCurve });
    expectCounts(view.band, [6, 2, 2, 2, 1]);
    expect(view.analysis.curve.rows[0]?.intensityGPerKwh).toBe(0);
    expect(within(view.band).getByText(/^Missing backend\/model clock-hours: 02:00, 03:00/)).toBeInTheDocument();
    expectUnchanged(view);
  });

  it('measures invalid-only array accounting rather than marking its counts unknown', () => {
    const view = show({ curve: [null, { hour_of_day: 24, g_co2_per_kwh: 1 },
      { hour_of_day: 0, g_co2_per_kwh: -1 }] });
    expectCounts(view.band, [3, 0, 2, 2, 0]);
    expect(within(view.band).getByText(/Missing backend\/model clock-hours: 00:00, 01:00/)).toBeInTheDocument();
    expectUnchanged(view);
  });

  it('keeps complete all-zero-intensity coverage measured and discloses duplicate-only incompleteness', () => {
    const curve = Array.from({ length: 24 }, (_, hour_of_day) => ({ hour_of_day, g_co2_per_kwh: 0 }));
    const complete = show({ curve });
    expectCounts(complete.band, [24, 24, 0, 0, 0]);
    expect(within(complete.band).getByText('Coverage is complete: exactly one valid row exists for every backend/model clock-hour.')).toBeInTheDocument();
    expectUnchanged(complete);
    complete.unmount();
    const duplicate = show({ curve: [...curve, { hour_of_day: 0, g_co2_per_kwh: 1 }] });
    expectCounts(duplicate.band, [25, 24, 0, 0, 1]);
    expect(within(duplicate.band).getByText('Coverage is incomplete because invalid or duplicate rows were returned.')).toBeInTheDocument();
    expectUnchanged(duplicate);
  });

  it('preserves loading shell and suppresses numeric readings even with array analysis', () => {
    const view = show({ curve: mixedCurve }, { data: undefined, isLoading: true,
      isPending: true, isSuccess: false, isFetching: true, fetchStatus: 'fetching' });
    expectCounts(view.band, unknownCounts, true);
    expect(view.band.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(within(view.band).getByText('Loading evidence')).toBeInTheDocument();
    expect(within(view.band).getByRole('status', { name: 'Loading carbon evidence' })).toBeInTheDocument();
    expectUnchanged(view);
  });

  it('preserves fatal-source recovery and unknown counts without retained data', () => {
    const view = show(undefined, { isSuccess: false, isError: true, error: new Error('synthetic fatal source') });
    expectCounts(view.band, unknownCounts);
    expect(within(view.band).getByText('Evidence unavailable')).toBeInTheDocument();
    expect(within(view.band).getByText('This source is unavailable. Retry it from the source and scope ledger.')).toBeInTheDocument();
    fireEvent.click(within(view.band).getByRole('button', { name: /Retry/ }));
    expect(view.onRetry).toHaveBeenCalledTimes(1);
    expectUnchanged(view);
  });

  it.each([
    { caseId: 'unresolved source', overrides: { isSuccess: false, isPending: true }, enabled: true,
      message: 'Source availability has not resolved yet.' },
    { caseId: 'paused source', overrides: { isSuccess: false, isPending: true, fetchStatus: 'paused' as const }, enabled: true,
      message: 'The query is paused while the network is unavailable; this is not treated as an empty response.' },
    { caseId: 'disabled source', overrides: {}, enabled: false,
      message: 'Select a vehicle to load this vehicle-dependent evidence.' },
  ])('preserves the $caseId shell and explanation without measured zeros', ({ overrides, enabled, message }) => {
    const view = show(undefined, overrides, enabled);
    expectCounts(view.band, unknownCounts);
    expect(within(view.band).getByText('Evidence unavailable')).toBeInTheDocument();
    expect(within(view.band).getByText(message)).toBeInTheDocument();
    expectUnchanged(view);
  });

  it.each([
    { caseId: 'refresh failure', overrides: { isError: true, error: new Error('synthetic refresh failure'), isSuccess: false },
      message: 'Refresh failed; the most recently loaded evidence remains visible.' },
    { caseId: 'paused refresh', overrides: { fetchStatus: 'paused' as const },
      message: 'The network is unavailable; cached evidence remains visible while refresh is paused.' },
  ])('retains exact array counts and retry during $caseId', ({ overrides, message }) => {
    const view = show({ curve: mixedCurve }, overrides);
    expectCounts(view.band, [6, 2, 2, 2, 1]);
    assertOperationalBriefDisclosure(view.band, 'Retained evidence');
    expect(within(view.band).getByText(message)).toBeInTheDocument();
    fireEvent.click(within(view.band).getByRole('button', { name: 'Retry' }));
    expect(view.onRetry).toHaveBeenCalledTimes(1);
    expectUnchanged(view);
  });

  it('keeps malformed retained counts unknown and retains authoritative empty-array zeros', () => {
    const overrides = { fetchStatus: 'paused' as const };
    const malformed = show({ curve: null }, overrides);
    expectCounts(malformed.band, unknownCounts);
    assertOperationalBriefDisclosure(malformed.band, 'Retained evidence');
    expectUnchanged(malformed);
    malformed.unmount();
    const empty = show({ curve: [] }, overrides);
    expectCounts(empty.band, zeroCounts);
    assertOperationalBriefDisclosure(empty.band, 'Retained evidence');
    expectUnchanged(empty);
  });

  it('preserves specialist formatting preferences and the real review-details action', () => {
    const formatting = { ...display, formatNumber: (raw: number | null | undefined) =>
      raw == null ? '—' : new Intl.NumberFormat('de-DE', { minimumFractionDigits: 3 }).format(raw) };
    const view = show({ curve: mixedCurve }, {}, true, formatting);
    expect(view.band.querySelector('[data-operational-metric="carbon-coverage-0"] [data-operational-value]')).toHaveTextContent('6,000');
    fireEvent.click(within(view.band).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    labels.forEach(label => expect(within(dialog).getByText(label)).toBeInTheDocument());
    expect(within(dialog).getByText('6,000')).toBeInTheDocument();
    expectUnchanged(view);
  });

  it.each([
    { caseId: 'returned malformed evidence', overrides: {}, status: 'Returned evidence' },
    { caseId: 'retained refresh failure', overrides: { isError: true, isSuccess: false,
      error: new Error('synthetic retained malformed source') }, status: 'Retained evidence' },
    { caseId: 'retained paused refresh', overrides: { fetchStatus: 'paused' as const },
      status: 'Retained evidence' },
  ])('withholds missing-hour claims and preserves the expected denominator for $caseId', ({ overrides, status }) => {
    const formatting = { ...display, formatHour: vi.fn(display.formatHour) };
    const view = show({ curve: null }, overrides, true, formatting);
    expectCounts(view.band, unknownCounts);
    expect(within(view.band).getByText('Unknown')).toBeInTheDocument();
    expect(within(view.band).getByText('24 expected clock-hours')).toBeInTheDocument();
    expect(within(view.band).getByText(status)).toBeInTheDocument();
    expect(within(view.band).queryByText(/Missing backend\/model clock-hours:/)).not.toBeInTheDocument();
    expect(within(view.band).queryByText(/^Coverage is complete:/)).not.toBeInTheDocument();
    expect(within(view.band).queryByText(/^Coverage is incomplete/)).not.toBeInTheDocument();
    expect(formatting.formatHour).not.toHaveBeenCalled();
    expect(display.formatNumber).not.toHaveBeenCalled();
    if (view.state.refreshError || view.state.refreshPaused) {
      fireEvent.click(within(view.band).getByRole('button', { name: 'Retry' }));
      expect(view.onRetry).toHaveBeenCalledTimes(1);
    }
    fireEvent.click(within(view.band).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    labels.forEach(label => expect(within(dialog).getByText(label)).toBeInTheDocument());
    expect(within(dialog).getByText('24 expected clock-hours')).toBeInTheDocument();
    expect(within(dialog).getAllByText('—')).toHaveLength(5);
    expectUnchanged(view);
  });
});
