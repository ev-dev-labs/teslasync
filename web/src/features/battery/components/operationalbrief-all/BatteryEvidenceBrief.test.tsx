import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display';
import { BatteryEvidenceBrief } from './BatteryEvidenceBrief';
import { BatteryCellsStats } from '../battery-cells-modernization/BatteryCellsStats';

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
    },
    formatTemperature: (raw: number) => `${raw.toFixed(2)}°C`,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('battery source evidence through the real OperationalBrief and bridge', () => {
  it('keeps zero, missing and invalid distinct and retains signed specialist readings and drawer context', () => {
    const metrics: readonly StatMetric[] = Object.freeze([
      { metricId: 'power', occurrenceId: 'grid', label: 'Grid power', rawValue: -2500,
        display: { formatter: raw => ({ value: (raw / 1000).toFixed(2), unit: 'kW' }) },
        context: 'Exporting to grid' },
      { metricId: 'count', occurrenceId: 'sessions', label: 'Sessions', rawValue: 0,
        description: 'Counted completed sessions in the returned window' },
      { metricId: 'energy', occurrenceId: 'missing', label: 'Capacity', rawValue: null,
        missingReason: 'No qualified capacity estimate' },
      { metricId: 'number', occurrenceId: 'invalid', label: 'Voltage', rawValue: Number.NaN },
    ]);
    const before = metrics.map(metric => metric.rawValue);
    const view = render(<BatteryEvidenceBrief id="real-battery-brief" title="Source evidence"
      metrics={metrics} retained period={{ kind: 'unknown', label: 'Returned window',
        reason: 'Independent sources have different bounds' }} />, { wrapper: Provider });
    const root = view.container.querySelector('[data-operational-brief]');
    expect(root).not.toBeNull();
    const readings = view.container.querySelectorAll('[data-operational-metric]');
    expect(readings).toHaveLength(4);
    expect(readings[0]).toHaveAttribute('data-value-state', 'value');
    expect(readings[0].querySelector('[data-operational-value]')).toHaveTextContent('-2.50 kW');
    expect(readings[1]).toHaveAttribute('data-value-state', 'value');
    expect(readings[1].querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(readings[2]).toHaveAttribute('data-value-state', 'missing');
    expect(readings[3]).toHaveAttribute('data-value-state', 'invalid');
    expect(screen.getByText('Retained source evidence')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('Exporting to grid')).toBeVisible();
    expect(drawer.getByText('No qualified capacity estimate')).toBeVisible();
    expect(drawer.getByText('Counted completed sessions in the returned window')).toBeVisible();
    expect(drawer.getAllByText('Independent sources have different bounds').length).toBeGreaterThan(0);
    expect(metrics.map(metric => metric.rawValue)).toEqual(before);
  });

  it('exposes loading without replacing source shells or claiming a measured zero', () => {
    const view = render(<BatteryEvidenceBrief title="Pending evidence" loading
      metrics={[{ metricId: 'energy', rawValue: undefined, label: 'Capacity' }]}
      period={{ kind: 'snapshot', label: 'Snapshot', observedAt: null, provenance: 'No measurement timestamp' }} />,
    { wrapper: Provider });
    expect(view.container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading source evidence')).toBeVisible();
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(view.container.querySelector('[data-operational-metric]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.queryByText('0 kWh')).not.toBeInTheDocument();
  });

  it('keeps absent cell extrema and pack readings absent with truthful synthesis provenance', () => {
    const view = render(<BatteryCellsStats data={undefined} cells={[]} minCell={null} maxCell={null}
      loading={false} retained={false} updatedAt={null} variant="overview" />, { wrapper: Provider });
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(view.container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getAllByText(/synthesized from brick extrema/).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('dialog')).getAllByText(/reported values alone do not establish health/).length).toBeGreaterThan(0);
  });

  it('keeps retained measurements and specialist diagnostics visible during a refresh', () => {
    const formatter = vi.fn((raw: number) => ({ value: raw.toFixed(3), unit: 'V' }));
    const view = render(<BatteryEvidenceBrief id="retained-battery" title="Retained readings"
      description="Qualified pack snapshot" secondary="Refresh failed; showing the last source snapshot."
      loading retained metrics={[
        { metricId: 'number', rawValue: 0, label: 'Voltage', display: { formatter },
          context: 'Measured zero, not an inferred pack health assessment' },
        { metricId: 'energy', rawValue: null, label: 'Capacity', missingReason: 'Estimate unavailable' },
      ]} period={{ kind: 'snapshot', label: 'Last source snapshot', observedAt: null,
        provenance: 'Independent pack source' }} />, { wrapper: Provider });
    expect(view.container.querySelector('[data-operational-brief]')).not.toHaveAttribute('aria-busy');
    expect(screen.getByText('Retained source evidence')).toBeVisible();
    expect(screen.queryByText('Loading source evidence')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-operational-value]')).toHaveTextContent('0.000 V');
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(1);
    expect(formatter).toHaveBeenCalledWith(0, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('0.000 V')).toBeVisible();
    expect(drawer.getByText('Measured zero, not an inferred pack health assessment')).toBeVisible();
    expect(drawer.getByText('Estimate unavailable')).toBeVisible();
    expect(drawer.getAllByText(/Refresh failed; showing the last source snapshot/).length).toBeGreaterThan(0);
    expect(drawer.getByText('Independent pack source')).toBeVisible();
  });

  it.each(['Refresh paused by the source policy', 'Offline; no source snapshot available'])(
    'preserves unavailable source explanations without inventing readings: %s',
    secondary => {
      const view = render(<BatteryEvidenceBrief title="Unavailable evidence" secondary={secondary}
        metrics={[{ metricId: 'energy', label: 'Capacity', rawValue: undefined }]}
        period={{ kind: 'unknown', label: 'Unknown source window', reason: 'No qualified source window' }} />,
      { wrapper: Provider });
      expect(screen.getByText('Source readings unavailable')).toBeVisible();
      expect(screen.getByText(secondary, { exact: false })).toBeVisible();
      expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
      expect(view.container.querySelector('[data-operational-metric]')).toHaveAttribute('data-value-state', 'missing');
      expect(screen.queryByText('0 kWh')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      expect(within(screen.getByRole('dialog')).getAllByText(/No qualified source window/).length).toBeGreaterThan(0);
    },
  );

  it('preserves partial readings, long RTL context and the compact review action', () => {
    const context = 'مصدر مستقل — '.repeat(40);
    const view = render(<div dir="rtl"><BatteryEvidenceBrief title="Partial battery evidence"
      description="Only the returned measurements are available" secondary="Other sources have not reported"
      metrics={[
        { metricId: 'count', label: 'Sessions', rawValue: 0, context },
        { metricId: 'energy', label: 'Capacity', rawValue: null },
      ]} period={{ kind: 'unknown', label: 'Returned window', reason: 'Mixed source bounds' }} /></div>,
    { wrapper: Provider });
    expect(screen.getByText('Available source readings')).toBeVisible();
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(2);
    expect(view.container.querySelectorAll('[data-value-state="value"]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(1);
    expect(view.container.querySelector('[data-battery-detail-context]')?.textContent).toBe(context);
    expect(view.container.querySelector('[data-operational-brief] [role="list"]')).toHaveClass('grid-cols-1');
    const review = screen.getByRole('button', { name: 'Review details' });
    expect(review).toHaveClass('min-h-11');
    fireEvent.click(review);
    expect(within(screen.getByRole('dialog')).getByText(context.trim())).toBeVisible();
    expect(within(screen.getByRole('dialog')).getAllByText(/Mixed source bounds/).length).toBeGreaterThan(0);
  });
});
