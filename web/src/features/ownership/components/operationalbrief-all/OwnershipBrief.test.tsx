import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { StatMetric } from '@/components/data-display';
import type { UnitPref } from '@/lib/unitConversion';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { OwnershipBrief } from './OwnershipBrief';
import { specialistDisplay } from './specialistDisplay';
import { formatBytes, formatCurrencyMinor, formatSignedPct } from '../../formatters';
import { BADGE_VARIANTS } from '@/components/ui';
import type { DataQuality } from '@/types/ownership';
import { EvidencePanel } from '../EvidencePanel';
import { formatDateTime } from '@/lib/dateFormat';

const { translationKeys } = vi.hoisted(() => ({ translationKeys: vi.fn() }));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { tz_display_default: 'user' },
    locale: 'de-DE',
  }),
}));
vi.mock('@/lib/timezone', () => ({
  useTimezone: () => 'America/Los_Angeles',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
      translationKeys(key);
      const options = typeof fallback === 'object' && fallback != null
        ? fallback as Record<string, unknown> : values ?? {};
      const text = typeof fallback === 'string' ? fallback
        : typeof options.defaultValue === 'string' ? options.defaultValue : key;
      return Object.entries(options).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, String(value)), text,
      );
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
    } satisfies UnitPref,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

const metrics: readonly StatMetric[] = [
  { occurrenceId: 'size', metricId: 'bytes', label: 'Binary size', rawValue: 2 * 1024 ** 2,
    display: specialistDisplay(formatBytes), context: 'Policy scope only' },
  { occurrenceId: 'zero', metricId: 'bytes', label: 'Observed zero', rawValue: 0,
    display: specialistDisplay(formatBytes) },
  { occurrenceId: 'unknown', metricId: 'count', label: 'Unknown count', rawValue: null },
];

describe('OwnershipBrief real OperationalBrief and numeric bridge', () => {
  it('formats recorded bounds and both freshness instants using saved locale and timezone without changing source values', () => {
    const window = Object.freeze({
      from: '2026-01-01T00:30:00Z', to: '2026-01-01T08:30:00Z',
    });
    const observedAt = '2026-01-01T00:45:00Z';
    const source = Object.freeze({ data: {}, dataUpdatedAt: Date.parse('2026-01-01T01:00:00Z') });
    const opts = { locale: 'de-DE', tz: 'America/Los_Angeles' };
    render(<OwnershipBrief title="Tariff evidence" description="Recorded tariff"
      scope="Business minutes 00:00–24:00" metrics={metrics}
      source={source} window={window} observedAt={observedAt} />);
    expect(screen.getByText(`Recorded bounds ${formatDateTime(window.from, opts)} → ${formatDateTime(window.to, opts)}`))
      .toBeInTheDocument();
    expect(screen.getByText(`Source as of ${formatDateTime(observedAt, opts)}`)).toBeInTheDocument();
    expect(screen.getByText(`Client loaded ${formatDateTime(new Date(source.dataUpdatedAt), opts)}`))
      .toBeInTheDocument();
    expect(screen.getByText('Business minutes 00:00–24:00')).toBeInTheDocument();
    expect(formatDateTime(window.from, opts)).toContain('31. Dez. 2025');
    expect(formatDateTime(window.to, opts)).toContain('1. Jan. 2026');
    expect(window).toEqual({ from: '2026-01-01T00:30:00Z', to: '2026-01-01T08:30:00Z' });
    expect(source.dataUpdatedAt).toBe(Date.parse('2026-01-01T01:00:00Z'));
  });

  it('preserves unknown bounds and freshness and safely renders invalid dates', () => {
    const { rerender } = render(<OwnershipBrief title="Tariff evidence" description="Recorded tariff"
      scope="Business minutes 00:00–24:00" metrics={metrics} source={{ data: {} }} />);
    expect(screen.getByText('Recorded analysis bounds not supplied')).toBeInTheDocument();
    expect(screen.getByText('Source freshness unknown')).toBeInTheDocument();
    expect(screen.queryByText(/Client loaded/)).not.toBeInTheDocument();
    rerender(<OwnershipBrief title="Tariff evidence" description="Recorded tariff"
      scope="Business minutes 00:00–24:00" metrics={metrics}
      source={{ data: {}, dataUpdatedAt: Number.MAX_VALUE }}
      window={{ from: 'invalid', to: 'invalid' }} observedAt="invalid" />);
    expect(screen.getByText('Recorded bounds — → —')).toBeInTheDocument();
    expect(screen.getByText('Source as of —')).toBeInTheDocument();
    expect(screen.getByText('Client loaded —')).toBeInTheDocument();
    expect(screen.getByText('Business minutes 00:00–24:00')).toBeInTheDocument();
    rerender(<OwnershipBrief title="Tariff evidence" description="Recorded tariff"
      scope="Business minutes 00:00–24:00" metrics={metrics} source={{ data: {} }}
      window={{ from: '2026-01-01T00:30:00Z', to: '' }} observedAt="" />);
    expect(screen.getByText('Recorded analysis bounds not supplied')).toBeInTheDocument();
    expect(screen.getByText('Source freshness unknown')).toBeInTheDocument();
  });

  it('retains numerical raw input and the original specialist byte display', () => {
    const { result } = renderHook(() => useOperationalMetrics(metrics));
    expect(result.current[0]).toMatchObject({ rawValue: 2 * 1024 ** 2, valueState: 'value', value: '2.0 MiB' });
    expect(result.current[1]).toMatchObject({ rawValue: 0, valueState: 'value', value: '0 B' });
    expect(result.current[2]).toMatchObject({ rawValue: null, valueState: 'missing', value: '—' });
  });

  describe('EvidencePanel canonical quality and source preservation', () => {
    const quality: DataQuality = {
      status: 'limited', sample_count: 0, coverage_pct: 0,
      window_start: null, window_end: null, reasons: ['Observation window is short'],
    };
    const evidence = [
      { source: 'Recorded service', summary: 'Confirmed inspection', sample_count: 0, observed_at: null },
      { source: 'Warranty register', summary: 'Recorded coverage', sample_count: 2, observed_at: null },
    ];

    it('formats evidence instants and observation bounds with saved preferences without changing raw data or business dates', () => {
      const datedQuality = Object.freeze({
        ...quality,
        window_start: '2026-01-01T00:30:00Z',
        window_end: '2026-01-01T08:30:00Z',
      });
      const datedEvidence = Object.freeze({
        source: 'Recorded service', summary: 'Business date 2026-01-01',
        sample_count: 2, observed_at: '2026-01-01T00:45:00Z',
      });
      const opts = { locale: 'de-DE', tz: 'America/Los_Angeles' };
      render(<EvidencePanel quality={datedQuality} evidence={[datedEvidence]}
        source={{ data: {}, dataUpdatedAt: Date.parse('2026-01-02T00:00:00Z') }} />);
      const region = screen.getByRole('region', { name: 'Data quality' });
      expect(within(region).getByRole('row', {
        name: `Observation window ${formatDateTime(datedQuality.window_start, opts)} – ${formatDateTime(datedQuality.window_end, opts)}`,
      })).toBeInTheDocument();
      const sources = screen.getByRole('region', { name: 'Evidence sources' });
      expect(sources).toHaveTextContent(`2 samples · ${formatDateTime(datedEvidence.observed_at, opts)}`);
      expect(sources).not.toHaveTextContent(formatDateTime('2026-01-02T00:00:00Z', opts));
      expect(screen.getByText('Business date 2026-01-01')).toBeInTheDocument();
      expect(datedQuality.window_start).toBe('2026-01-01T00:30:00Z');
      expect(datedQuality.window_end).toBe('2026-01-01T08:30:00Z');
      expect(datedEvidence.observed_at).toBe('2026-01-01T00:45:00Z');
    });

    it('keeps missing and invalid evidence timestamps unknown and preserves a partial observation window', () => {
      const opts = { locale: 'de-DE', tz: 'America/Los_Angeles' };
      const { rerender } = render(<EvidencePanel
        quality={{ ...quality, window_start: '2026-01-01T00:30:00Z', window_end: null }}
        evidence={[
          { source: 'Invalid observation', summary: 'Unparseable source time', observed_at: 'invalid' },
          { source: 'Missing observation', summary: 'No source time', sample_count: 0, observed_at: null },
        ]} />);
      expect(screen.getByRole('row', {
        name: `Observation window ${formatDateTime('2026-01-01T00:30:00Z', opts)} – —`,
      })).toBeInTheDocument();
      const sources = screen.getByRole('region', { name: 'Evidence sources' });
      expect(within(sources).getByText('—')).toBeInTheDocument();
      expect(within(sources).getByText('0 samples · —')).toBeInTheDocument();
      expect(sources).not.toHaveTextContent('Invalid Date');
      rerender(<EvidencePanel quality={{ ...quality, window_start: 'invalid', window_end: 'invalid' }}
        evidence={[]} />);
      expect(screen.getByRole('row', { name: 'Observation window — – —' })).toBeInTheDocument();
    });

    it.each([
      ['sufficient', 'success'],
      ['limited', 'warning'],
      ['insufficient', 'danger'],
    ] as const)('renders one canonical %s quality badge with its original %s tone', (status, tone) => {
      translationKeys.mockClear();
      render(<EvidencePanel quality={{ ...quality, status }} evidence={evidence}
        limitations={['Only recorded observations']} unsupported={['Future failures']} />);
      const region = screen.getByRole('region', { name: 'Data quality' });
      const badge = within(region).getByText(status);
      expect(within(region).getAllByText(status)).toHaveLength(1);
      expect(translationKeys.mock.calls.filter(([key]) => key === `ownership.verdict.${status}`)).toHaveLength(1);
      for (const token of BADGE_VARIANTS[tone].split(' ')) expect(badge).toHaveClass(token);
      expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(region).toHaveTextContent('Observation window is short');
      const sources = screen.getByRole('region', { name: 'Evidence sources' });
      for (const item of evidence) {
        expect(sources).toHaveTextContent(item.source);
        expect(sources).toHaveTextContent(item.summary);
      }
      expect(sources).toHaveTextContent('0 samples');
      expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('Only recorded observations');
      expect(screen.getByText('Future failures')).toBeInTheDocument();
    });

    it('does not infer empty evidence or zero quality while loading or paused without data', () => {
      const { rerender } = render(<EvidencePanel source={{ isLoading: true, fetchStatus: 'fetching' }} />);
      expect(screen.getByRole('status', { name: 'Loading Evidence, quality, and limitations' })).toBeInTheDocument();
      expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Data quality' })).not.toBeInTheDocument();
      rerender(<EvidencePanel source={{ isPending: true, fetchStatus: 'paused' }} />);
      expect(screen.getByText('The initial query is paused while the network is unavailable; no empty response is inferred.')).toBeInTheDocument();
      expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
      expect(screen.queryByText('Samples')).not.toBeInTheDocument();
    });

    it('preserves successful empty arrays and measured zero values', () => {
      render(<EvidencePanel quality={quality} evidence={[]} limitations={[]} unsupported={[]}
        source={{ data: {}, isSuccess: true }} />);
      const region = screen.getByRole('region', { name: 'Data quality' });
      expect(within(region).getByRole('row', { name: 'Samples 0' })).toBeInTheDocument();
      expect(within(region).getByRole('row', { name: /Coverage 0(?:\.0+)?%/ })).toBeInTheDocument();
      expect(screen.getByText('No supporting evidence was returned.')).toBeInTheDocument();
      expect(screen.getByText('No additional limitations were returned.')).toBeInTheDocument();
      expect(screen.queryByText('Explicitly not computed')).not.toBeInTheDocument();
    });

    it('keeps quality, reasons and evidence through a retained refresh failure and recovery', () => {
      const props = { quality, evidence, limitations: ['Recorded sources only'], unsupported: ['Prediction'] };
      const { rerender } = render(<EvidencePanel {...props}
        source={{ data: {}, isError: true, error: new Error('Refresh failed') }} />);
      const warning = 'The latest values are temporarily unavailable. Previously loaded data remains visible.';
      expect(screen.getByText(warning)).toBeInTheDocument();
      expect(screen.getByText('limited')).toBeInTheDocument();
      expect(screen.getByText(/Observation window is short/)).toBeInTheDocument();
      for (const item of evidence) expect(screen.getByText(item.summary)).toBeInTheDocument();
      expect(screen.getByText(/Recorded sources only/)).toBeInTheDocument();
      expect(screen.getByText(/Prediction/)).toBeInTheDocument();
      rerender(<EvidencePanel {...props} source={{ data: {}, isSuccess: true, fetchStatus: 'idle' }} />);
      expect(screen.queryByText(warning)).not.toBeInTheDocument();
      expect(screen.getByText('limited')).toBeInTheDocument();
      for (const item of evidence) expect(screen.getByText(item.summary)).toBeInTheDocument();
    });
  });

  it('renders real markers, source state and rich captions in the built-in drawer', () => {
    const { container } = render(<OwnershipBrief title="Storage evidence" description="Policy coverage is not deletion"
      scope="Database catalog" source={{ data: {}, dataUpdatedAt: 1767225600000 }} metrics={metrics} />);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(container.querySelector('[data-operational-metric="size"]')).toHaveTextContent('2.0 MiB');
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="unknown"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Source returned')).toBeInTheDocument();
    expect(screen.getByText('Source freshness unknown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Policy scope only')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('2.0 MiB');
    expect(dialog).toHaveTextContent('No measurement supplied');
  });

  it('exposes loading without zero values and downgrades retained/offline sources honestly', () => {
    const { container, rerender } = render(<OwnershipBrief title="Storage evidence" description="Returned catalog"
      scope="Database catalog" source={{ isLoading: true }} metrics={metrics} />);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<OwnershipBrief title="Storage evidence" description="Returned catalog" scope="Database catalog"
      source={{ data: {}, fetchStatus: 'paused' }} metrics={metrics} />);
    assertOperationalBriefDisclosure(document.body, 'Retained source');
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveTextContent('0 B');
  });

  it.each([
    {},
    { isPending: true },
    { isLoading: true, isPending: true },
  ])('distinguishes an initial paused source from loading, retained data, empty results and failure (%j)', (flags) => {
    const { container, rerender } = render(<OwnershipBrief title="Tariff evidence" description="Recorded tariff"
      scope="Recorded tariff scope" source={{ ...flags, fetchStatus: 'paused' }} metrics={[]} />);
    const paused = screen.getByText('Source paused');
    expect(paused).toBeInTheDocument();
    for (const token of BADGE_VARIANTS.neutral.split(' ')) expect(paused).toHaveClass(token);
    expect(container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    for (const label of ['Loading source', 'Refreshing source', 'Retained source', 'Not computed', 'Source unavailable', 'Source returned']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Client loaded/)).not.toBeInTheDocument();
    rerender(<OwnershipBrief title="Tariff evidence" description="Recorded tariff"
      scope="Recorded tariff scope" source={{ isPending: true, isLoading: true, fetchStatus: 'fetching' }} metrics={[]} />);
    expect(screen.queryByText('Source paused')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(document.body, 'Loading source');
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    rerender(<OwnershipBrief title="Tariff evidence" description="Recorded tariff"
      scope="Recorded tariff scope" source={{ data: {}, isSuccess: true, fetchStatus: 'idle' }} metrics={metrics} />);
    expect(screen.getByText('Source returned')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveTextContent('0 B');
  });

  it.each([
    [{ data: {}, fetchStatus: 'paused' as const }, 'Retained source', 'warning'],
    [{ data: {}, isError: true, error: new Error('Refresh failed') }, 'Retained source', 'warning'],
    [{ data: {}, isFetching: true, fetchStatus: 'fetching' as const }, 'Refreshing source', 'neutral'],
    [{ data: {}, isSuccess: true, fetchStatus: 'idle' as const }, 'Source returned', 'neutral'],
  ] as const)('preserves populated source status for %j', (source, label, tone) => {
    const { container } = render(<OwnershipBrief title="Tariff evidence" description="Recorded tariff"
      scope="Recorded tariff scope" source={source} metrics={metrics} />);
    const status = screen.getByText(label);
    for (const token of BADGE_VARIANTS[tone].split(' ')) expect(status).toHaveClass(token);
    expect(screen.queryByText('Source paused')).not.toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(container.querySelector('[data-operational-metric="size"]')).toHaveTextContent('2.0 MiB');
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveTextContent('0 B');
    expect(container.querySelector('[data-operational-metric="unknown"]')).toHaveAttribute('data-value-state', 'missing');
  });

  it('validates finite and count inputs before calling the specialist callback', () => {
    const formatter = vi.fn((raw: number) => String(raw));
    const invalid: readonly StatMetric[] = [
      { metricId: 'bytes', rawValue: Number.NaN, display: specialistDisplay(formatter) },
      { metricId: 'count', rawValue: -1, display: specialistDisplay(formatter) },
      { metricId: 'bytes', rawValue: null, display: specialistDisplay(formatter) },
    ];
    const { result } = renderHook(() => useOperationalMetrics(invalid));
    expect(result.current.map((metric) => metric.valueState)).toEqual(['invalid', 'invalid', 'missing']);
    expect(formatter).not.toHaveBeenCalled();
  });

  it('keeps recorded minor denominations, signed percentages and the fixed wear-cost basis numerical', () => {
    const sourceMetrics: readonly StatMetric[] = [
      { metricId: 'currency', rawValue: 12345,
        display: specialistDisplay((raw) => formatCurrencyMinor(raw, 'JPY', 'en-US')) },
      { metricId: 'currency', rawValue: -12345,
        display: specialistDisplay((raw) => formatCurrencyMinor(raw, 'USD', 'en-US')) },
      { metricId: 'currency', rawValue: 12345,
        display: specialistDisplay((raw) => formatCurrencyMinor(raw, 'KWD', 'en-US')) },
      { metricId: 'percent', rawValue: 12.5, display: specialistDisplay(formatSignedPct) },
      { metricId: 'rate', rawValue: 0.5,
        display: specialistDisplay((raw) => `${formatCurrencyMinor(raw * 1000, 'USD', 'en-US')} / 1000 m`) },
    ];
    const { result } = renderHook(() => useOperationalMetrics(sourceMetrics));
    expect(result.current.map((metric) => metric.rawValue)).toEqual([12345, -12345, 12345, 12.5, 0.5]);
    expect(result.current.map((metric) => metric.valueState)).toEqual(['value', 'value', 'value', 'value', 'value']);
    expect(result.current[0].value).toContain('12,345');
    expect(result.current[1].value).toBe('-$123.45');
    expect(result.current[2].value).toContain('12.345');
    expect(result.current[3].value).toMatch(/^\+12\.5(?:0)?%$/);
    expect(result.current[4].value).toBe('$5.00 / 1000 m');
  });
});
