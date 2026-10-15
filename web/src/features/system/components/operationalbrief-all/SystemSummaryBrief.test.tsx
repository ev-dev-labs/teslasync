import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SystemSummaryBrief } from './SystemSummaryBrief';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { StatMetric } from '@/components/data-display/stat-reference/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, vars?: Record<string, unknown>) =>
      (fallback ?? key).replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match),
  }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: {
    locale: 'en-US', decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', currency_symbol: '$',
  }, settingsUnavailable: false }),
}));

afterEach(cleanup);
const measurements: readonly StatMetric[] = [
  { metricId: 'count', occurrenceId: 'count', rawValue: 0, label: 'Count', context: 'Loaded rows only' },
  { metricId: 'bytes', occurrenceId: 'bytes', rawValue: 2048, label: 'Recorded bytes' },
  { metricId: 'duration', occurrenceId: 'gap', rawValue: null, label: 'Gap' },
];
const props = {
  title: 'Source summary', description: 'Recorded evidence, not a forecast',
  scope: 'Different source windows remain explicit', available: true, metrics: measurements,
};

describe('system source summaries use the real raw bridge and review drawer', () => {
  it('keeps raw count and bytes numeric and does not substitute a missing duration with zero', () => {
    const { result } = renderHook(() => useOperationalMetrics(measurements));
    expect(result.current.map(metric => metric.rawValue)).toEqual([0, 2048, null]);
    expect(result.current.map(metric => metric.valueState)).toEqual(['value', 'value', 'missing']);
    const { container } = render(<MemoryRouter><SystemSummaryBrief {...props} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="count"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="gap"]')).toHaveAttribute('data-value-state', 'missing');
    expect(container.querySelector('[data-operational-metric="bytes"] [data-operational-value]')).toHaveTextContent('2.00 KB');
  });

  it('retains each measurement and textual context through a background source failure', () => {
    const { container } = render(<MemoryRouter><SystemSummaryBrief {...props} retained
      textMetrics={[{ key: 'type', label: 'Most exported', value: 'drives', detail: 'By count' }]} /></MemoryRouter>);
    expect(screen.getByText('Retained source')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="count"] [data-operational-value]')).toHaveTextContent('0');
    expect(screen.getByText('By count')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(within(drawer).getByRole('region', { name: 'How this was calculated' }))
      .getByText('Different source windows remain explicit')).toBeInTheDocument();
    expect(within(drawer).getByText('By count')).toBeInTheDocument();
    expect(within(drawer).getByText('Loaded rows only')).toBeInTheDocument();
  });

  it('keeps labels mounted during initial loading while withholding resolved values', () => {
    const { container, rerender } = render(<MemoryRouter><SystemSummaryBrief {...props} available={false} loading /></MemoryRouter>);
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    rerender(<MemoryRouter><SystemSummaryBrief {...props} available={false}
      metrics={measurements.map(metric => ({ ...metric, rawValue: null }))} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(3);
    expect(screen.getByText('Source unavailable')).toBeInTheDocument();
  });
});
