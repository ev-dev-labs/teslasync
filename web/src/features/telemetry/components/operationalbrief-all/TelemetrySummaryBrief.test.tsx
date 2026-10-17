import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import './metricPreferencesTestSetup';
import { TelemetrySummaryBrief } from './TelemetrySummaryBrief';

const preferences = vi.hoisted(() => ({
  locale: 'en-US', timezone_user: 'UTC', tz_display_default: 'user',
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: preferences, locale: preferences.locale }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, fallback?: unknown, variables?: Record<string, unknown>) => {
    const text = typeof fallback === 'string' ? fallback : key;
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(variables?.[name] ?? `{{${name}}}`));
  },
  i18n: { language: 'en' },
}) }));
vi.mock('@/hooks/useOperationalMetrics', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  preferences.locale = 'en-US';
  preferences.timezone_user = 'UTC';
});

const metrics: readonly StatMetric[] = Object.freeze([
  Object.freeze({ metricId: 'rate' as const, occurrenceId: 'rate', rawValue: 1.234567,
    label: 'Signal rate', description: 'One-second tail rate; not broker lifetime throughput',
    display: { formatter: (raw: number) => ({ value: String(raw), unit: '/s' }) } }),
  Object.freeze({ metricId: 'ratio' as const, occurrenceId: 'r', rawValue: -0.812345,
    label: 'Coefficient', description: 'Signed coefficient, not percentage', display: { precision: 4 } }),
  Object.freeze({ metricId: 'duration' as const, occurrenceId: 'lag', rawValue: -120,
    label: 'Lag', description: 'Negative means A lags B', display: { precision: 0, units: { duration: 's' as const } } }),
]);
function setup(overrides: Partial<Parameters<typeof TelemetrySummaryBrief>[0]> = {}) {
  return render(<TelemetrySummaryBrief title="Signal evidence" description="Independent returned evidence"
    metrics={metrics} testId="brief" scope="24h requested; overlap only"
    provenance="Producer-time history; receipt fallbacks excluded" {...overrides} />);
}

describe('Telemetry compact OperationalBrief contract', () => {
  it('forwards embedded mode to the shared surface', () => {
    const { container } = setup({ variant: 'embedded' });
    expect(container.querySelector('[data-operational-brief-surface="embedded"]')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief-surface="standalone"]')).toBeNull();
  });

  it('uses saved locale and timezone across day boundaries without losing exact evidence in either surface', () => {
    preferences.locale = 'de-DE';
    preferences.timezone_user = 'America/Los_Angeles';
    const from = '2026-01-02T07:59:59.123Z';
    const to = '2026-01-02T08:00:00.456Z';
    setup({
      requestedBounds: [{ signal: 'requested', from, to }],
      sourceBounds: [{ signal: 'source', from, to }],
      observedBounds: [{ signal: 'numeric', from, to }],
      lastSuccessAt: to, completenessUnknown: true,
    });
    const localizedFrom = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(from));
    const localizedTo = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(to));
    expect(localizedFrom).toContain('1. Jan.');
    expect(localizedTo).toContain('2. Jan.');
    const evidence = [
      `Requested: ${from} → ${to}`,
      `source source bounds: ${from} → ${to}`,
      `Observed evidence: ${from} → ${to}`,
      `(${localizedFrom} → ${localizedTo} · America/Los_Angeles)`,
      `Last successful response: ${to} (${localizedTo} · America/Los_Angeles)`,
      'Returned evidence; completeness not guaranteed',
      '24h requested; overlap only',
      'Independent returned evidence',
    ];
    const face = screen.getByTestId('brief');
    for (const text of evidence) expect(face).not.toHaveTextContent(text);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    for (const text of evidence) expect(drawer).toHaveTextContent(text);
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0]).toBe(metrics);
  });

  it.each([
    {},
    { from: 'invalid', to: 'also-invalid' },
    { from: '2026-01-02T08:00:00Z' },
    { from: '2026-01-03T00:00:00Z', to: '2026-01-02T00:00:00Z' },
  ])('keeps missing or invalid dates unknown with saved preferences: %j', bounds => {
    preferences.locale = 'fr-FR';
    preferences.timezone_user = 'Asia/Tokyo';
    setup({
      requestedBounds: [{ signal: 'request', ...bounds }],
      observedBounds: [{ signal: 'numeric', ...bounds }],
      sourceBounds: [{ signal: 'source', ...bounds }],
      lastSuccessAt: 'invalid',
    });
    const unknown = [
      'Requested · request source bounds not supplied',
      'Observed · numeric source bounds not supplied',
      'source source bounds not supplied',
      'Last successful response: Unknown',
    ];
    const absent = ['Invalid Date', 'Asia/Tokyo', 'full-range coverage'];
    const face = screen.getByTestId('brief');
    for (const text of unknown) expect(face).not.toHaveTextContent(text);
    for (const text of absent) expect(face).not.toHaveTextContent(text);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    for (const text of unknown) expect(drawer).toHaveTextContent(text);
    for (const text of absent) expect(drawer).not.toHaveTextContent(text);
  });

  it('does not infer completeness from matching requested, observed, and source extrema', () => {
    const bounds = { signal: 'A', from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' };
    setup({ requestedBounds: [bounds], sourceBounds: [bounds], observedBounds: [bounds] });
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Queried snapshot');
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Queried snapshot');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Complete');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Cap reached');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Partial source coverage');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Last successful response:');
  });

  it('distinguishes requested and observed bounds and cap uncertainty while retaining payload and caveats', () => {
    const { container } = setup({
      requestedBounds: [{ signal: 'A', from: '2026-01-01T00:00:00Z', to: '2026-01-04T00:00:00Z' }],
      observedBounds: [{ signal: 'A', from: '2026-01-02T01:00:00Z', to: '2026-01-02T02:00:00Z' }],
      capReached: true,
    });
    const summary = screen.getByTestId('brief');
    expect(summary).not.toHaveTextContent('Requested: 2026-01-01T00:00:00Z → 2026-01-04T00:00:00Z');
    expect(summary).not.toHaveTextContent('Observed evidence: 2026-01-02T01:00:00Z → 2026-01-02T02:00:00Z');
    expect(summary).not.toHaveTextContent('Cap reached; full-range coverage not claimed');
    expect(summary).not.toHaveTextContent('Partial source coverage');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Requested: 2026-01-01T00:00:00Z');
    expect(drawer).toHaveTextContent('Observed evidence: 2026-01-02T01:00:00Z');
    expect(drawer).toHaveTextContent('Cap reached; full-range coverage not claimed');
    expect(drawer).toHaveTextContent('Partial source coverage');
    expect(drawer).toHaveTextContent('One-second tail rate; not broker lifetime throughput');
    expect(drawer).toHaveTextContent('Producer-time history; receipt fallbacks excluded');
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0]).toBe(metrics);
  });

  it.each([
    { from: 'not-a-date', to: '2026-01-02T00:00:00Z' },
    { from: '2026-01-03T00:00:00Z', to: '2026-01-02T00:00:00Z' },
    { from: '2026-01-01T00:00:00Z' },
  ])('does not replace invalid observed bounds with requested or source bounds: %j', bound => {
    setup({
      requestedBounds: [{ signal: 'A', from: '2026-01-01T00:00:00Z', to: '2026-01-04T00:00:00Z' }],
      observedBounds: [{ signal: 'A', ...bound }],
      sourceBounds: [{ signal: 'B', ...bound }],
      completenessUnknown: true,
    });
    const summary = screen.getByTestId('brief');
    expect(summary).not.toHaveTextContent('Observed · A source bounds not supplied');
    expect(summary).not.toHaveTextContent('B source bounds not supplied');
    expect(summary).not.toHaveTextContent('Observed evidence:');
    expect(summary).not.toHaveTextContent('Returned evidence; completeness not guaranteed');
    expect(summary).not.toHaveTextContent('Cap reached');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Observed · A source bounds not supplied');
    expect(drawer).toHaveTextContent('B source bounds not supplied');
    expect(drawer).toHaveTextContent('Returned evidence; completeness not guaranteed');
    expect(drawer).not.toHaveTextContent('Observed evidence:');
    expect(drawer).not.toHaveTextContent('Cap reached');
  });

  it('keeps last-success freshness separate from observed timestamps and failed refreshes', () => {
    const { container, rerender } = setup({
      retained: true, loading: true, unavailable: true, capReached: true,
      lastSuccessAt: '2026-01-03T00:00:00Z',
      freshness: 'Refresh failed; last successful measurement retained',
      observedBounds: [{ signal: 'A', from: '2026-01-02T01:00:00Z', to: '2026-01-02T02:00:00Z' }],
    });
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Last successful response: 2026-01-03T00:00:00Z');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Refresh failed; last successful measurement retained');
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Last successful response: 2026-01-03T00:00:00Z', { contains: true });
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Refresh failed; last successful measurement retained', { contains: true });
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Retained source data', { contains: true });
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Last successful response: 2026-01-03T00:00:00Z');
    expect(drawer).toHaveTextContent('Cap reached; full-range coverage not claimed');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<TelemetrySummaryBrief title="Signal evidence" description="Independent returned evidence"
      metrics={metrics} testId="brief" scope="Requested range" provenance="History"
      retained lastSuccessAt="invalid" />);
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Last successful response:');
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Last successful response: Unknown', { contains: true });
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Last successful response: invalid', { contains: true, absent: true });
  });

  it('uses the actual raw bridge without rounding input rate, coefficient, or signed lag', () => {
    const { container } = setup();
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-stat-strip], [data-role="metric-card"]')).toHaveLength(0);
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0]).toBe(metrics);
    expect(metrics.map(metric => metric.rawValue)).toEqual([1.234567, -0.812345, -120]);
    expect(container.querySelector('[data-operational-metric="rate"] [data-operational-value]'))
      .toHaveTextContent('1.234567 /s');
    expect(container.querySelector('[data-operational-metric="r"] [data-operational-value]'))
      .not.toHaveTextContent('%');
    expect(container.querySelector('[data-operational-metric="lag"] [data-operational-value]'))
      .toHaveTextContent('-120 s');
  });

  it('keeps the real Review details drawer, all captions, scope, and provenance', () => {
    setup();
    expect(screen.getByTestId('brief')).not.toHaveTextContent('24h requested; overlap only');
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), '24h requested; overlap only');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Signal evidence details' });
    expect(within(drawer).getByText('Signal rate')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('One-second tail rate; not broker lifetime throughput');
    expect(drawer).toHaveTextContent('Signed coefficient, not percentage');
    expect(drawer).toHaveTextContent('Negative means A lags B');
    expect(drawer).toHaveTextContent('Producer-time history; receipt fallbacks excluded');
  });

  it('retains independent source-reported bounds without fabricating missing bounds', () => {
    setup({ retained: true, sourceBounds: [
      { signal: 'A', from: '2026-01-01T01:02:03Z', to: '2026-01-02T04:05:06Z' },
      { signal: 'B' },
    ] });
    expect(screen.getByTestId('brief')).not.toHaveTextContent('A source bounds: 2026-01-01T01:02:03Z → 2026-01-02T04:05:06Z');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('B source bounds not supplied');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('A source bounds: 2026-01-01T01:02:03Z → 2026-01-02T04:05:06Z');
    expect(drawer).toHaveTextContent('2026-01-02T04:05:06Z');
    expect(drawer).toHaveTextContent('B source bounds not supplied');
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0]).toBe(metrics);
  });

  it('distinguishes measured zero, missing, and invalid raw values', () => {
    const measurements: readonly StatMetric[] = [
      { metricId: 'count', occurrenceId: 'zero', rawValue: 0, label: 'Zero', description: 'Successful empty result' },
      { metricId: 'count', occurrenceId: 'missing', rawValue: null, label: 'Missing', description: 'Unavailable source' },
      { metricId: 'rate', occurrenceId: 'nan', rawValue: NaN, label: 'Invalid', description: 'Non-finite source' },
      { metricId: 'count', occurrenceId: 'negative', rawValue: -1, label: 'Negative count', description: 'Invalid source count' },
    ];
    const { container } = setup({ metrics: measurements });
    const cells = [...container.querySelectorAll('[data-operational-metric]')];
    expect(cells).toHaveLength(1);
    expect(cells[0]?.querySelector('[data-operational-value]')).toHaveTextContent('0');
    const hookResults = vi.mocked(useOperationalMetrics).mock.results;
    const lastResult = hookResults[hookResults.length - 1];
    expect(lastResult?.type).toBe('return');
    if (lastResult?.type === 'return') {
      expect(lastResult.value.map(metric => metric.valueState)).toEqual(['value', 'missing', 'invalid', 'invalid']);
    }
    for (const label of ['Missing', 'Invalid', 'Negative count']) {
      assertOperationalMetricUnavailable(screen.getByTestId('brief'), label);
    }
    expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0].map(metric => metric.rawValue))
      .toEqual([0, null, NaN, -1]);
  });

  it('exposes initial loading without values and does not blank retained evidence during refresh', () => {
    const { container, rerender } = setup({ loading: true });
    expect(screen.getByTestId('brief')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<TelemetrySummaryBrief title="Signal evidence" description="Independent returned evidence"
      metrics={metrics} testId="brief" scope="24h overlap" provenance="History"
      loading retained unavailable />);
    expect(screen.getByTestId('brief')).not.toHaveAttribute('aria-busy', 'true');
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Retained source data', { contains: true });
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(3);
  });

  it('does not turn partial or unavailable coverage into a healthy status', () => {
    const { rerender } = setup({ sourceStatus: 'partial' });
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Partial source coverage');
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Partial source coverage');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('On track');
    rerender(<TelemetrySummaryBrief title="Signal evidence" description="Independent returned evidence"
      metrics={[]} testId="brief" scope="Unknown coverage" provenance="History" unavailable />);
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Source unavailable', { contains: true });
  });

  it('keeps long source identities and incomplete bounds as muted, wrapping metadata in both surfaces', () => {
    const signal = `source-${'long-identity-'.repeat(12)}`;
    setup({ sourceBounds: [
      { signal, from: '2026-01-01T01:02:03Z' },
      { signal: 'observed', from: '2026-01-02T04:05:06Z', to: '2026-01-02T04:06:07Z' },
    ] });
    const summary = screen.getByTestId('brief');
    expect(summary).not.toHaveTextContent(`${signal} source bounds not supplied`);
    expect(summary).not.toHaveTextContent('24h requested; overlap only');
    expect(summary).not.toHaveTextContent('2026-01-01T01:02:03Z');
    expect(summary).not.toHaveTextContent('observed source bounds: 2026-01-02T04:05:06Z → 2026-01-02T04:06:07Z');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    const missingBounds = within(drawer).getByText(`${signal} source bounds not supplied`, { exact: false });
    expect(missingBounds).toHaveClass('min-w-0', 'break-words');
    expect(missingBounds).not.toHaveClass('truncate');
    expect(drawer).toHaveTextContent(`${signal} source bounds not supplied`);
    expect(drawer).toHaveTextContent('24h requested; overlap only');
    expect(drawer).toHaveTextContent('observed source bounds: 2026-01-02T04:05:06Z → 2026-01-02T04:06:07Z');
  });

  it.each(['Refresh failed; last successful measurement retained', 'Offline; refresh paused'])(
    'preserves caller-owned freshness without inventing source metadata: %s',
    message => {
      setup({ retained: true, sourceStatus: 'stale', freshness: <span>{message}</span> });
      assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Retained source data', { contains: true });
      expect(screen.getByTestId('brief')).not.toHaveTextContent(message);
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      expect(screen.getByRole('dialog')).toHaveTextContent(message);
      expect(vi.mocked(useOperationalMetrics).mock.lastCall?.[0]).toBe(metrics);
    },
  );

  it('preserves explicit unknown, empty source, and caller-supplied fatal labels without measured zeros', () => {
    const { container, rerender } = setup({ metrics: [], unknown: true });
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Source values unknown');
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Source values unknown');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<TelemetrySummaryBrief title="Signal evidence" description="Independent returned evidence"
      metrics={[]} testId="brief" scope="Requested range" provenance="Unknown source"
      sourceStatus="initialFailure" statusLabel="Initial source request failed" />);
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Initial source request failed');
    assertOperationalBriefDisclosure(screen.getByTestId('brief'), 'Initial source request failed');
    expect(screen.getByTestId('brief')).not.toHaveTextContent('Queried snapshot');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });
});
