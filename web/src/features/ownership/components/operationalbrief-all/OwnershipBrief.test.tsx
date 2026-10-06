import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { StatMetric } from '@/components/data-display';
import type { UnitPref } from '@/lib/unitConversion';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { OwnershipBrief } from './OwnershipBrief';
import { specialistDisplay } from './specialistDisplay';
import { formatBytes, formatCurrencyMinor, formatSignedPct } from '../../formatters';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => {
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
  it('retains numerical raw input and the original specialist byte display', () => {
    const { result } = renderHook(() => useOperationalMetrics(metrics));
    expect(result.current[0]).toMatchObject({ rawValue: 2 * 1024 ** 2, valueState: 'value', value: '2.0 MiB' });
    expect(result.current[1]).toMatchObject({ rawValue: 0, valueState: 'value', value: '0 B' });
    expect(result.current[2]).toMatchObject({ rawValue: null, valueState: 'missing', value: '—' });
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
    expect(screen.getByText('Retained source')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="zero"]')).toHaveTextContent('0 B');
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
