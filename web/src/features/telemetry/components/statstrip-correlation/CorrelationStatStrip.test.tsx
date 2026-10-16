import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { CorrelationResult } from '../../lib/signalCorrelation';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { CorrelationStatStrip } from './CorrelationStatStrip';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(vars?.[key] ?? `{{${key}}}`)),
}) }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: 'km', speed: 'km/h', temperature: 'C',
    pressure: 'kPa', energy: 'kWh', duration: 'h', power: 'kW', locale: 'de-DE', precision: 4 },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '€' }) }));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});

const result: CorrelationResult = {
  bestR: -0.812345, zeroLagR: 0.123456, bestLagS: -120, bestN: 1111,
  effectiveN: 42.49, significanceThreshold: 0.301234, significant: true, lead: 'b',
  correlogram: [], seriesA: { t: [], v: [], stepMs: 60000, filled: 0, gaps: 0 },
  seriesB: { t: [], v: [], stepMs: 60000, filled: 0, gaps: 0 },
  overlapStartMs: null, overlapEndMs: null,
};
const initial = getFormatterPreferences();
afterEach(() => {
  cleanup();
  setGlobalLocale(initial.locale);
  setGlobalPrecision(initial.precision);
});

function setup(overrides: Partial<Parameters<typeof CorrelationStatStrip>[0]> = {}) {
  return render(<CorrelationStatStrip result={result} leadLabel="Cabin temperature leads"
    loading={false} retained={false} errorA={null} errorB={null}
    onRetryA={vi.fn()} onRetryB={vi.fn()} {...overrides} />, { wrapper: MemoryRouter });
}

describe('Correlation canonical summary preservation', () => {
  it.each([
    { zeroLagR: null, zeroLagReason: 'insufficient' as const },
    { zeroLagR: null, zeroLagReason: 'invalid' as const },
    { zeroLagR: Number.NaN, zeroLagReason: 'invalid' as const },
    { zeroLagR: Number.POSITIVE_INFINITY, zeroLagReason: 'invalid' as const },
  ])('shows an unknown zero-lag marker without losing the signed peak ($zeroLagReason, $zeroLagR)', unavailable => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(4);
    const { container } = setup({ result: { ...result, ...unavailable } });
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    expect(tiles[0]).toHaveTextContent('at zero lag: —');
    expect(tiles[0]).not.toHaveTextContent('at zero lag: 0');
    expect(tiles[0]?.querySelector('[data-operational-value]')).toHaveTextContent('-0,8123');
    expect(tiles[1]).toHaveTextContent('-120 s');
    expect(tiles[1]).toHaveTextContent('Cabin temperature leads');
  });

  it.each([0, 0.123456, -0.123456])('renders valid zero-lag coefficients without replacing them with unknown (%s)', zeroLagR => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(4);
    const { container } = setup({ result: { ...result, zeroLagR, zeroLagReason: null } });
    const peak = container.querySelector('[data-operational-metric="peak-r"]');
    expect(peak).toHaveTextContent(`at zero lag: ${zeroLagR === 0 ? '0' : zeroLagR > 0 ? '0,1235' : '-0,1235'}`);
    expect(peak).not.toHaveTextContent('at zero lag: —');
  });

  it('preserves a positive fractional peak and signal A lead orientation', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(4);
    const { container } = setup({
      result: { ...result, bestR: 0.812345, bestLagS: 120, lead: 'a' },
      leadLabel: 'HVAC power leads',
    });
    expect(container.querySelector('[data-operational-metric="peak-r"] [data-operational-value]'))
      .toHaveTextContent('0,8123');
    expect(container.querySelector('[data-operational-metric="best-lag"]'))
      .toHaveTextContent('120 s');
    expect(container.querySelector('[data-operational-metric="best-lag"]'))
      .toHaveTextContent('HVAC power leads');
  });

  it('renders the actual OperationalBrief with four evidence metrics and original overlapping-history scope', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(4);
    const { container } = setup();
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-stat-strip]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument();
    expect(container).toHaveTextContent('Last 24 hours requested; overlapping samples only');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Correlation metrics details' });
    expect(within(details).getByText('Peak correlation')).toBeInTheDocument();
    expect(within(details).getByText('-0,8123')).toBeInTheDocument();
    expect(within(details).getByText('-120 s')).toBeInTheDocument();
    expect(details).toHaveTextContent('Cabin temperature leads');
    expect(details).toHaveTextContent('from 1.111 overlapping resampled pairs');
    expect(details).toHaveTextContent('needs |r| > 0,3012');
  });

  it('keeps signed seconds, coefficients not percentages, adjusted samples and full scientific context', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(4);
    const frozen = Object.freeze({ ...result });
    const { container } = setup({ result: frozen });
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    const measurements = vi.mocked(useOperationalMetrics).mock.lastCall?.[0];
    expect(measurements?.map(metric => metric.metricId)).toEqual(['ratio', 'duration', 'status', 'number']);
    expect(measurements?.map(metric => metric.rawValue)).toEqual([-0.812345, -120, 'Real', 42.49]);
    expect(measurements?.[1]?.display).toEqual({ units: { duration: 's' }, precision: 0 });
    expect(tiles.map(tile => tile.getAttribute('data-operational-metric'))).toEqual(['peak-r', 'best-lag', 'significance', 'effective-n']);
    expect(tiles.map(tile => tile.querySelector('[data-operational-value]')?.textContent))
      .toEqual(['-0,8123', '-120 s', 'Real', '42']);
    expect(tiles[0]).toHaveTextContent('at zero lag: 0,1235');
    expect(tiles[0]?.querySelector('[data-operational-value]')).not.toHaveTextContent('%');
    expect(tiles[1]?.querySelector('[data-operational-value]')).toHaveTextContent(/^-120 s$/);
    expect(tiles[1]).toHaveTextContent('Cabin temperature leads');
    expect(tiles[2]).toHaveTextContent('needs |r| > 0,3012');
    expect(tiles[3]).toHaveTextContent('from 1.111 overlapping resampled pairs');
    expect(screen.getByTestId('signal-correlation-summary')).toHaveTextContent('Last 24 hours requested; overlapping samples only');
    expect(screen.getByTestId('signal-correlation-summary')).toHaveTextContent('exact request bounds are not supplied');
    expect(frozen.bestR).toBe(-0.812345);
    expect(frozen.bestLagS).toBe(-120);
    expect(frozen.effectiveN).toBe(42.49);
  });

  it('does not invent zero raw samples when result is null; true zeros remain valid', () => {
    const { container, rerender } = setup({ result: null });
    expect([...container.querySelectorAll('[data-operational-metric]')].map(tile => tile.getAttribute('data-value-state')))
      .toEqual(['missing', 'missing', 'missing', 'missing']);
    expect(container).toHaveTextContent('from — overlapping resampled pairs');
    expect(container).not.toHaveTextContent('from 0 overlapping resampled pairs');
    rerender(<CorrelationStatStrip result={{ ...result, bestR: 0, zeroLagR: 0, bestLagS: 0, bestN: 0,
      effectiveN: 0, significant: false }} leadLabel="Simultaneous" loading={false} retained={false}
      errorA={null} errorB={null} onRetryA={vi.fn()} onRetryB={vi.fn()} />);
    expect([...container.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'value')).toBe(true);
    expect(container).toHaveTextContent('Noise');
    expect(container).toHaveTextContent('from 0 overlapping resampled pairs');
  });

  it('discloses original counts only when supplied, without inferring them from grid coverage', () => {
    setGlobalLocale('en-US');
    const { container } = setup();
    expect(container).not.toHaveTextContent('Signal A:');
    expect(container).not.toHaveTextContent('Signal B:');
    cleanup();
    const supplied = setup({ result: { ...result, sourceCountA: 20, validCountA: 12,
      sourceCountB: 15, validCountB: 10 } }).container;
    expect(supplied).toHaveTextContent('from 1,111 overlapping resampled pairs');
    expect(supplied).toHaveTextContent('Signal A: 20 source records');
    expect(supplied).toHaveTextContent('Signal A: 12 valid timestamp-deduplicated measurements');
    expect(supplied).toHaveTextContent('Signal B: 15 source records');
    expect(supplied).toHaveTextContent('Signal B: 10 valid timestamp-deduplicated measurements');
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    'omits unavailable or invalid original counts rather than showing zero (%s)', count => {
      const { container } = setup({ result: { ...result, sourceCountA: count,
        validCountA: count, sourceCountB: 0, validCountB: 0 } });
      expect(container).not.toHaveTextContent('Signal A:');
      expect(container).toHaveTextContent('Signal B: 0 source records');
      expect(container).toHaveTextContent('Signal B: 0 valid timestamp-deduplicated measurements');
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('does not display invalid pair counts as measured zero (%s)', bestN => {
    const { container } = setup({ result: { ...result, bestN } });
    expect(container).toHaveTextContent('from — overlapping resampled pairs');
    expect(container).not.toHaveTextContent('from 0 overlapping resampled pairs');
  });

  it('retains measurements and independently retries each failed history source', () => {
    const retryA = vi.fn();
    const retryB = vi.fn();
    const { container } = setup({ loading: true, retained: true,
      errorA: new Error('A unavailable'), errorB: new Error('B unavailable'),
      onRetryA: retryA, onRetryB: retryB });
    assertOperationalBriefDisclosure(screen.getByTestId('signal-correlation-summary'), 'Retained source data', { contains: true });
    expect(screen.getByTestId('signal-correlation-summary')).toHaveTextContent('Showing retained measurements');
    expect(screen.getByTestId('signal-correlation-summary')).not.toHaveAttribute('aria-busy', 'true');
    expect([...container.querySelectorAll('[data-operational-metric]')].every(tile => tile.getAttribute('data-value-state') === 'value')).toBe(true);
    const retries = screen.getAllByRole('button', { name: 'Retry' });
    fireEvent.click(retries[0]!);
    expect(retryA).toHaveBeenCalledOnce();
    expect(retryB).not.toHaveBeenCalled();
    fireEvent.click(retries[1]!);
    expect(retryB).toHaveBeenCalledOnce();
  });

  it('keeps the canonical four tiles in initial loading without leaking computed values', () => {
    const { container } = setup({ result: null, loading: true });
    expect(screen.getByTestId('signal-correlation-summary')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('signal-correlation-summary')).toHaveTextContent('Loading sources');
    expect([...container.querySelectorAll('[data-operational-metric]')].map(tile => tile.getAttribute('data-value-state')))
      .toEqual(['missing', 'missing', 'missing', 'missing']);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });
});
