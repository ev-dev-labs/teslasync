import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationalBriefMetric } from '@/components/data-display/OperationalBrief';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { glossary, type MetricPreferences, type MetricRaw, type StatPeriod } from '@/lib/metric-reference';
import { fmtNumber } from '@/lib/numberFormat';
import { convertDurationFromSI } from '@/lib/unitConversion';
import { formatOperationalMetrics } from './operationalMetrics';

const preferences: MetricPreferences = Object.freeze({
  units: Object.freeze({
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  }),
  currency: Object.freeze({ kind: 'symbol', value: '$' }),
});
const translate = (_key: string, fallback: string): string => fallback;
const unknownPeriod: StatPeriod = {
  kind: 'unknown', label: 'Prior source window', reason: 'Prior bounds unverified',
};

function renderPresentation(metrics: readonly OperationalBriefMetric[]) {
  return render(
    <MemoryRouter initialEntries={['/reports/current']}>
      {metrics.map(metric => (
        <section key={metric.key} aria-label={metric.label}>
          {metric.value}
          {metric.detail}
        </section>
      ))}
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('formatOperationalMetrics pure presentation contract', () => {
  it('keeps original SI operands and zero identity independently of rounded display', () => {
    const source: readonly StatMetric[] = Object.freeze([
      Object.freeze({ metricId: 'energy', rawValue: 1234.56789 }),
      Object.freeze({ metricId: 'distance', rawValue: 2345.6789 }),
      Object.freeze({ metricId: 'number', rawValue: -0 }),
      Object.freeze({ metricId: 'count', rawValue: 0 }),
    ]);
    const before = source.map(metric => ({ ...metric }));
    const result = formatOperationalMetrics(source, preferences, translate);

    expect(result.map(metric => metric.value)).toEqual(['1.23 kWh', '2.35 km', '0.00', '0']);
    expect(result.map(metric => metric.valueState)).toEqual(['value', 'value', 'value', 'value']);
    result.forEach((metric, index) => {
      expect(Object.is(metric.rawValue, source[index].rawValue)).toBe(true);
    });
    expect(source).toEqual(before);
    expect(preferences.units.energy).toBe('kWh');
    expect(preferences.units.distance).toBe('km');
  });

  it('uses neutral unknown semantics without inferring a count from an integer', () => {
    const result = formatOperationalMetrics([
      { metricId: 'number', rawValue: 7 },
      { metricId: 'count', rawValue: 7 },
    ], preferences, translate);

    expect(result[0]).toMatchObject({ label: 'Value', value: '7.00', rawValue: 7, valueState: 'value' });
    expect(result[1]).toMatchObject({ label: 'Count', value: '7', rawValue: 7, valueState: 'value' });
    renderPresentation(result);
    expect(screen.getByText(glossary.number.description)).toHaveTextContent('semantic meaning remains unknown');
    expect(screen.getByText(glossary.count.description)).toBeInTheDocument();
  });

  it.each([
    { name: 'null', raw: null, state: 'missing', reason: 'No measurement supplied' },
    { name: 'undefined', raw: undefined, state: 'missing', reason: 'No measurement supplied' },
    { name: 'NaN', raw: NaN, state: 'invalid', reason: 'Expected a finite numeric measurement' },
    { name: 'positive infinity', raw: Infinity, state: 'invalid', reason: 'Expected a finite numeric measurement' },
    { name: 'negative infinity', raw: -Infinity, state: 'invalid', reason: 'Expected a finite numeric measurement' },
    { name: 'numeric source text', raw: '1200', state: 'invalid', reason: 'Expected a finite numeric measurement' },
  ] satisfies readonly { name: string; raw: MetricRaw; state: 'missing' | 'invalid'; reason: string }[])(
    'exposes $name state and translated reason on both linked value and detail',
    ({ raw, state, reason }) => {
      const translatedReason = `Localized reason: ${reason}`;
      const localize = (key: string, fallback: string) =>
        key.startsWith('developerReference.stats.reason.') ? `Localized reason: ${fallback}` : fallback;
      const result = formatOperationalMetrics([
        { metricId: 'energy', rawValue: raw, label: 'Recorded energy', href: '/charging?source=recorded' },
      ], preferences, localize);

      expect(result[0].valueState).toBe(state);
      expect(Object.is(result[0].rawValue, raw)).toBe(true);
      renderPresentation(result);
      expect(screen.getByRole('link', { name: `Recorded energy: —; ${translatedReason}` }))
        .toHaveAttribute('href', '/charging?source=recorded');
      expect(screen.getByText(translatedReason)).toBeInTheDocument();
      expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
    },
  );

  it('preserves a caller reason verbatim rather than translating or replacing it', () => {
    const localize = vi.fn(translate);
    const result = formatOperationalMetrics([{
      metricId: 'power', rawValue: null, label: 'Source power',
      description: 'Measured source, not an estimate', missingReason: 'Meter was not published',
      href: '/sources/meter',
    }], preferences, localize);

    expect(localize).not.toHaveBeenCalled();
    renderPresentation(result);
    expect(screen.getByRole('link', { name: 'Source power: —; Meter was not published' })).toBeInTheDocument();
    expect(screen.getByText('Meter was not published')).toBeInTheDocument();
    expect(screen.getByText('Measured source, not an estimate')).toBeInTheDocument();
    expect(screen.queryByText('No measurement supplied')).not.toBeInTheDocument();
  });

  it('forwards validated raw operands and effective preferences to a genuine specialist formatter', () => {
    const formatter = vi.fn((raw: number, effective: MetricPreferences) => ({
      value: fmtNumber(convertDurationFromSI(raw, 'd'), effective.units.precision, effective.units.locale),
      unit: 'd',
    }));
    const display = Object.freeze({
      precision: 3, units: Object.freeze({ locale: 'de-DE' }), formatter,
    });
    const result = formatOperationalMetrics([
      { metricId: 'duration', rawValue: 172800, label: 'Retention', display },
      { metricId: 'duration', rawValue: 0, label: 'Elapsed', display },
    ], preferences, translate);

    expect(result.map(metric => metric.value)).toEqual(['2,000 d', '0,000 d']);
    expect(result.map(metric => metric.rawValue)).toEqual([172800, 0]);
    expect(formatter).toHaveBeenCalledTimes(2);
    expect(formatter).toHaveBeenNthCalledWith(1, 172800, {
      ...preferences, units: { ...preferences.units, locale: 'de-DE', precision: 3 },
    });
    expect(formatter).toHaveBeenNthCalledWith(2, 0, expect.objectContaining({
      units: expect.objectContaining({ locale: 'de-DE', precision: 3 }),
    }));
    expect(preferences.units.locale).toBe('en-US');
    expect(preferences.units.precision).toBe(2);
  });

  it('never lets specialist callbacks bypass finite, count or total domain validation', () => {
    const formatter = vi.fn((raw: number, effective: MetricPreferences) => ({
      value: fmtNumber(raw, 0, effective.units.locale), unit: 'recorded',
    }));
    const source: readonly StatMetric[] = [
      ...([null, undefined, NaN, Infinity, -Infinity, '4'] satisfies MetricRaw[])
        .map(rawValue => ({ metricId: 'count' as const, rawValue, display: { formatter } })),
      ...[-1, 1.5, Number.MAX_SAFE_INTEGER + 1]
        .map(rawValue => ({ metricId: 'count' as const, rawValue, display: { formatter } })),
      ...[-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
        .map(countTotal => ({ metricId: 'count' as const, rawValue: 1, display: { countTotal, formatter } })),
    ];
    const result = formatOperationalMetrics(source, preferences, translate);

    expect(formatter).not.toHaveBeenCalled();
    expect(result.map(metric => metric.valueState)).toEqual([
      'missing', 'missing', ...Array<string>(12).fill('invalid'),
    ]);
    expect(result.every(metric => metric.value === '—')).toBe(true);
    result.forEach((metric, index) => {
      expect(Object.is(metric.rawValue, source[index].rawValue)).toBe(true);
    });
    const valid = formatOperationalMetrics([{
      metricId: 'count', rawValue: 0, display: { countTotal: 0, formatter },
    }], preferences, translate);
    expect(formatter).toHaveBeenCalledTimes(1);
    expect(formatter).toHaveBeenCalledWith(0, preferences);
    expect(valid[0]).toMatchObject({ value: '0 recorded', rawValue: 0, valueState: 'value' });
  });

  it('retains rich context and independent comparison content alongside exact source-period reasons', async () => {
    const user = userEvent.setup();
    const result = formatOperationalMetrics([{
      metricId: 'energy', rawValue: 1250, label: 'Delivered energy',
      description: 'Recorded delivery excludes estimates',
      context: <Link to="/sources/evidence">Inspect meter evidence</Link>,
      comparisonContent: <strong>Prior meter incomplete: 3 of 5 sessions</strong>,
      comparison: { metricId: 'percent', rawValue: 12.5, signed: true,
        label: 'Change versus prior source', period: unknownPeriod },
    }], preferences, translate);
    render(
      <MemoryRouter initialEntries={['/reports/current']}>
        {result[0].detail}
        <Routes>
          <Route path="/reports/current" element={<span>Current source report</span>} />
          <Route path="/sources/evidence" element={<span>Meter evidence destination</span>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Recorded delivery excludes estimates')).toBeInTheDocument();
    expect(screen.getByText('Prior meter incomplete: 3 of 5 sessions').tagName).toBe('STRONG');
    expect(screen.getByText(
      'Change versus prior source: +12.50%; Prior source window; Prior bounds unverified',
    )).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Inspect meter evidence' }));
    expect(screen.getByText('Meter evidence destination')).toBeInTheDocument();
    expect(screen.queryByText('Current source report')).not.toBeInTheDocument();
  });

  it.each([
    { raw: 2.5, signed: true, text: '+2.50%' },
    { raw: -2.5, signed: true, text: '-2.50%' },
    { raw: 0, signed: true, text: '0.00%' },
    { raw: -0, signed: true, text: '0.00%' },
    { raw: 2.5, signed: false, text: '2.50%' },
  ])('retains signed comparison $text with its separate analysis period', ({ raw, signed, text }) => {
    const result = formatOperationalMetrics([{
      metricId: 'count', rawValue: 5, label: 'Current sessions', href: '/charging',
      comparison: { metricId: 'percent', rawValue: raw, signed, label: 'Change',
        period: { kind: 'analysis', label: 'Earlier complete range',
          start: '2026-09-01T00:00:00Z', endExclusive: '2026-10-01T00:00:00Z',
          timezone: 'UTC', completeness: 'complete', provenance: 'Recorded session totals' } },
    }], preferences, translate);
    const comparison = `Change: ${text}; Earlier complete range`;

    expect(result[0].rawValue).toBe(5);
    renderPresentation(result);
    expect(screen.getByText(comparison)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Current sessions: 5; ${comparison}` })).toBeInTheDocument();
    expect(screen.queryByText('Prior bounds unverified')).not.toBeInTheDocument();
  });

  it.each([
    { metricId: 'percent', rawValue: Infinity, reason: 'Expected a finite numeric measurement' },
    { metricId: 'count', rawValue: 1.5, reason: 'Expected a non-negative safe integer count' },
  ] as const)('does not attach a positive sign to invalid $metricId comparisons', ({ metricId, rawValue, reason }) => {
    const localize = (key: string, fallback: string): string =>
      key === 'developerReference.stats.valueState.invalid' ? 'Invalid source' : fallback;
    const result = formatOperationalMetrics([{
      metricId: 'number', rawValue: 8, label: 'Present measurement', href: '/evidence',
      comparison: { metricId, rawValue, signed: true, label: 'Prior measurement', period: unknownPeriod },
    }], preferences, localize);
    const comparison = `Prior measurement: —; Prior source window; Prior bounds unverified; Invalid source; ${reason}`;

    expect(result[0]).toMatchObject({ rawValue: 8, valueState: 'value' });
    renderPresentation(result);
    expect(screen.getByText(comparison)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Present measurement: 8.00; ${comparison}` })).toBeInTheDocument();
    expect(screen.queryByText(/\+—|\+Infinity/)).not.toBeInTheDocument();
  });

  it('keeps repeated semantic occurrences distinct and explicit occurrence keys stable across reordering', () => {
    const source: readonly StatMetric[] = [
      { metricId: 'count', rawValue: 1 },
      { metricId: 'count', rawValue: 2 },
      { metricId: 'energy', rawValue: 3000, occurrenceId: 'recorded:primary' },
      { metricId: 'energy', rawValue: 5000, occurrenceId: 'recorded:secondary' },
    ];
    const result = formatOperationalMetrics(source, preferences, translate);

    expect(result.map(metric => metric.key)).toEqual([
      'count:0', 'count:1', 'recorded:primary', 'recorded:secondary',
    ]);
    expect(new Set(result.map(metric => metric.key)).size).toBe(source.length);
    const reordered = formatOperationalMetrics([source[3], source[2]], preferences, translate);
    expect(reordered.map(metric => metric.key)).toEqual(['recorded:secondary', 'recorded:primary']);
    expect(formatOperationalMetrics([], preferences, translate)).toEqual([]);
  });

  it('translates default labels and descriptions but retains explicit source semantics and accessible navigation', async () => {
    const user = userEvent.setup();
    const localize = vi.fn((key: string, fallback: string): string => {
      if (key === 'developerReference.stats.metric.count.label') return 'Recorded items';
      if (key === 'developerReference.stats.metric.count.description') return 'Translated declared item count';
      return fallback;
    });
    const result = formatOperationalMetrics([
      { metricId: 'count', rawValue: 12 },
      { metricId: 'count', rawValue: 2, label: 'Admitted sessions',
        description: 'Only sessions meeting source eligibility', href: '/charging?eligible=true#recorded' },
    ], preferences, localize);

    expect(localize.mock.calls.map(([key]) => key)).toEqual([
      'developerReference.stats.metric.count.label', 'developerReference.stats.metric.count.description',
    ]);
    render(
      <MemoryRouter initialEntries={['/reports/current']}>
        {result[0].detail}
        {result[1].value}
        {result[1].detail}
        <Routes>
          <Route path="/reports/current" element={<span>Current report destination</span>} />
          <Route path="/charging" element={<span>Eligible charging destination</span>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(result[0].label).toBe('Recorded items');
    expect(screen.getByText('Translated declared item count')).toBeInTheDocument();
    expect(screen.getByText('Only sessions meeting source eligibility')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Admitted sessions: 2' });
    expect(link).toHaveAttribute('href', '/charging?eligible=true#recorded');
    expect(link).toHaveClass('focus-visible:ring-2');
    await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Eligible charging destination')).toBeInTheDocument();
    expect(screen.queryByText('Current report destination')).not.toBeInTheDocument();
  });
});
