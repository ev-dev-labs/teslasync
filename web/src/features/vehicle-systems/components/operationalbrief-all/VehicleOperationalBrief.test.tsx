import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { VehicleOperationalBrief } from './VehicleOperationalBrief';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: {
    distance: 'km', speed: 'km/h', energy: 'kWh', power: 'kW', temperature: '°C',
    pressure: 'bar', duration: 'h', precision: 2, locale: 'en-US',
  } }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '€' }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));

const period = {
  kind: 'unknown' as const,
  label: 'Returned climate rows',
  reason: 'Seven-day climate source and independently limited drive history; not complete coverage.',
};

describe('real vehicle OperationalBrief and numeric bridge', () => {
  it('retains raw pressure, seconds, source audio levels, signs, zero, and withheld values', () => {
    const sourceFormatter = vi.fn((raw: number) => ({ value: `source:${raw}`, unit: '' }));
    const metrics: readonly StatMetric[] = [
      { metricId: 'pressure', occurrenceId: 'pressure', label: 'Pressure', rawValue: 280 },
      { metricId: 'duration', occurrenceId: 'seconds', label: 'Seconds', rawValue: 120, display: { formatter: sourceFormatter } },
      { metricId: 'number', occurrenceId: 'volume', label: 'Audio level', rawValue: 0, display: { formatter: sourceFormatter } },
      { metricId: 'number', occurrenceId: 'delta', label: 'Signed delta', rawValue: -1.25, display: { formatter: sourceFormatter } },
      { metricId: 'count', occurrenceId: 'unknown', label: 'Unknown count', rawValue: null, missingReason: 'Independent source unavailable' },
      { metricId: 'number', occurrenceId: 'invalid', label: 'Invalid scalar', rawValue: Number.NaN, display: { formatter: sourceFormatter } },
    ];
    const hook = renderHook(() => useOperationalMetrics(metrics));
    expect(hook.result.current.map(metric => metric.rawValue)).toEqual([280, 120, 0, -1.25, null, Number.NaN]);
    expect(hook.result.current.map(metric => metric.valueState)).toEqual(['value', 'value', 'value', 'value', 'missing', 'invalid']);
    const view = render(<MemoryRouter><VehicleOperationalBrief id="vehicle-brief" title="Climate evidence"
      metrics={metrics} period={period} /></MemoryRouter>);
    const brief = view.container.querySelector('[data-operational-brief]');
    expect(brief).toBeInTheDocument();
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief?.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(brief?.querySelector('[data-operational-metric="pressure"] [data-operational-value]')).toHaveTextContent('2.80 bar');
    expect(brief?.querySelector('[data-operational-metric="volume"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief?.querySelector('[data-operational-metric="volume"] [data-operational-value]')).toHaveTextContent('source:0');
    expect(brief?.querySelector('[data-operational-metric="unknown"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief?.querySelector('[data-operational-metric="invalid"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(sourceFormatter.mock.calls.map(call => call[0])).not.toContainEqual(Number.NaN);
    expect(metrics[0].rawValue).toBe(280);
  });

  it('keeps mixed-source reasons and rich links inside the real drawer and restores the trigger', async () => {
    const metrics: StatMetric[] = [{
      metricId: 'count', occurrenceId: 'rows', label: 'Returned rows', rawValue: 0,
      description: 'Counts are not a monitoring assurance.',
      context: <a href="/fsd">Retained source drill-through</a>,
      comparisonContent: <span>Original denominator: 9 tracked settings</span>,
    }];
    const view = render(<MemoryRouter><VehicleOperationalBrief id="vehicle-brief" title="Safety evidence"
      metrics={metrics} period={period} retained footer={<span>Independent source retry remains available</span>} /></MemoryRouter>);
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
    expect(view.container.querySelector('[data-source-retained]')).toHaveAttribute('data-source-retained', 'true');
    const trigger = screen.getByRole('button', { name: 'Review details' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Safety evidence details' });
    expect(within(dialog).getByText('Counts are not a monitoring assurance.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Retained source drill-through' })).toHaveAttribute('href', '/fsd');
    expect(within(dialog).getByText('Original denominator: 9 tracked settings')).toBeInTheDocument();
    expect(within(dialog).getAllByText(period.reason).length).toBeGreaterThan(0);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByText('Independent source retry remains available')).toBeInTheDocument();
  });

  it('shows busy source shells without blanking retained readings on a later refresh', () => {
    const metrics: StatMetric[] = [{ metricId: 'count', occurrenceId: 'rows', label: 'Rows', rawValue: null }];
    const view = render(<VehicleOperationalBrief id="busy" title="Evidence" metrics={metrics} period={period} loading />);
    expect(view.container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(view.container.querySelector('[data-operational-value]')).not.toBeInTheDocument();
    view.rerender(<VehicleOperationalBrief id="busy" title="Evidence"
      metrics={[{ ...metrics[0], rawValue: 0 }]} period={period} retained />);
    expect(view.container.querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(view.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
  });
});
