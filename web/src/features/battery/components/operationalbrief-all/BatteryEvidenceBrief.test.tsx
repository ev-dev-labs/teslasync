import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { StatMetric } from '@/components/data-display';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { BatteryEvidenceBrief } from './BatteryEvidenceBrief';
import { BatteryCellsStats } from '../battery-cells-modernization/BatteryCellsStats';
import { formatDateTime } from '@/lib/dateFormat';

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
  it('renders an embedded brief without its own surface when hosted inside a card', () => {
    const view = render(<BatteryEvidenceBrief variant="embedded" title="Embedded evidence"
      metrics={[{ metricId: 'count', label: 'Sessions', rawValue: 1 }]}
      period={{ kind: 'unknown', label: 'Returned window', reason: 'Source bounds are unknown' }} />,
    { wrapper: Provider });
    expect(view.container.querySelector('[data-operational-brief-surface="embedded"]')).toBeInTheDocument();
    expect(view.container.querySelector('[data-operational-brief-surface="standalone"]')).toBeNull();
  });

  it.each([
    { locale: 'de-DE', tz: 'America/Los_Angeles' },
    { locale: 'ja-JP', tz: 'Asia/Tokyo' },
    undefined,
  ])('formats freshness with explicit context or unchanged shared defaults: %j', timestampContext => {
    const observedAt = '2026-08-08T00:30:00Z';
    const view = render(<BatteryEvidenceBrief title="Timestamp evidence" timestampContext={timestampContext}
      metrics={[{ metricId: 'count', label: 'Sessions', rawValue: 0 }]}
      period={{ kind: 'snapshot', label: 'Source snapshot', observedAt, provenance: 'Original evidence' }} />,
    { wrapper: Provider });
    const expected = formatDateTime(observedAt, timestampContext);
    assertOperationalBriefDisclosure(view.container, expected, { contains: true });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText(expected)).toBeVisible();
    expect(within(screen.getByRole('dialog')).getAllByText('Original evidence').length).toBeGreaterThan(0);
  });

  it.each(['not-a-date', null, undefined])('handles unavailable freshness without inventing evidence: %s', observedAt => {
    const view = render(<BatteryEvidenceBrief title="Timestamp evidence"
      timestampContext={{ locale: 'de-DE', tz: 'Asia/Tokyo' }}
      metrics={[{ metricId: 'count', label: 'Sessions', rawValue: 0 }]}
      period={{ kind: 'snapshot', label: 'Source snapshot', observedAt: observedAt ?? null, provenance: 'Original evidence' }} />,
    { wrapper: Provider });
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-operational-value]')).toHaveTextContent('0');
    if (observedAt) {
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      const dialog = screen.getByRole('dialog');
      const header = dialog.querySelector('[data-drawer-header]');
      if (!(header instanceof HTMLElement)) throw new Error('Review drawer header is missing');
      expect(within(header).getByText('—')).toBeVisible();
      fireEvent.keyDown(dialog, { key: 'Escape' });
    }
  });

  it('keeps descriptive scope visible without treating it as a source reading', () => {
    const view = render(<BatteryEvidenceBrief title="Selected scope"
      metrics={[{ metricId: 'text', label: 'Window', rawValue: 'Selected UTC dates' }]}
      period={{ kind: 'unknown', label: 'Selected window', reason: 'Requested scope, not response coverage' }} />,
    { wrapper: Provider });
    assertOperationalBriefDisclosure(view.container, 'Source readings unavailable', { contains: true });
    expect(screen.queryByText('Available source readings')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-operational-value]')).toHaveTextContent('Selected UTC dates');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getAllByText('Requested scope, not response coverage').length).toBeGreaterThan(0);
  });

  it('uses feature evidence support instead of response summaries and supports recovery', () => {
    const props = {
      title: 'Source support',
      metrics: [{ metricId: 'score', label: 'Breadth', rawValue: 0 }] satisfies StatMetric[],
      period: { kind: 'unknown', label: 'Requested window', reason: 'Scope only' } as const,
    };
    const view = render(<BatteryEvidenceBrief {...props} hasEvidence={false} retained />, { wrapper: Provider });
    assertOperationalBriefDisclosure(view.container, 'Source readings unavailable', { contains: true });
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();
    view.rerender(<BatteryEvidenceBrief {...props} hasEvidence retained />);
    assertOperationalBriefDisclosure(view.container, 'Retained source evidence', { contains: true });
    view.rerender(<BatteryEvidenceBrief {...props} hasEvidence />);
    assertOperationalBriefDisclosure(view.container, 'Available source readings', { contains: true });
    expect(screen.queryByText('Retained source evidence')).not.toBeInTheDocument();
  });

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
    expect(readings).toHaveLength(2);
    expect(readings[0]).toHaveAttribute('data-value-state', 'value');
    expect(readings[0].querySelector('[data-operational-value]')).toHaveTextContent('-2.50 kW');
    expect(readings[1]).toHaveAttribute('data-value-state', 'value');
    expect(readings[1].querySelector('[data-operational-value]')).toHaveTextContent('0');
    assertOperationalMetricUnavailable(view.container, 'Capacity');
    assertOperationalMetricUnavailable(view.container, 'Voltage');
    assertOperationalBriefDisclosure(view.container, 'Retained source evidence', { contains: true });
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('Exporting to grid')).toBeVisible();
    expect(drawer.queryByText('No qualified capacity estimate')).not.toBeInTheDocument();
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
    assertOperationalBriefDisclosure(view.container, 'Loading source evidence', { contains: true });
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(view.container.querySelector('[data-operational-metric]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.queryByText('0 kWh')).not.toBeInTheDocument();
  });

  it('keeps absent cell extrema and pack readings absent with truthful synthesis provenance', () => {
    const view = render(<BatteryCellsStats data={undefined} cells={[]} minCell={null} maxCell={null}
      loading={false} retained={false} updatedAt={null} variant="overview" />, { wrapper: Provider });
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    for (const label of ['Total cells', 'Avg voltage', 'Min cell', 'Max cell', 'Imbalance', 'Pack voltage']) {
      assertOperationalMetricUnavailable(view.container, label);
    }
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
    assertOperationalBriefDisclosure(view.container, 'Retained source evidence', { contains: true });
    expect(screen.queryByText('Loading source evidence')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-operational-value]')).toHaveTextContent('0.000 V');
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    assertOperationalMetricUnavailable(view.container, 'Capacity');
    expect(formatter).toHaveBeenCalledWith(0, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('0.000 V')).toBeVisible();
    expect(drawer.getByText('Measured zero, not an inferred pack health assessment')).toBeVisible();
    expect(drawer.queryByText('Estimate unavailable')).not.toBeInTheDocument();
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
      assertOperationalBriefDisclosure(view.container, 'Source readings unavailable', { contains: true });
      assertOperationalBriefDisclosure(view.container, secondary, { contains: true });
      expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
      assertOperationalMetricUnavailable(view.container, 'Capacity');
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
    assertOperationalBriefDisclosure(view.container, 'Available source readings', { contains: true });
    expect(view.container.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(view.container.querySelectorAll('[data-value-state="value"]')).toHaveLength(1);
    assertOperationalMetricUnavailable(view.container, 'Capacity');
    expect(view.container.querySelector('[data-operational-brief] [role="list"]')).toHaveAttribute('data-columns', '1');
    const review = screen.getByRole('button', { name: 'Review details' });
    expect(review).toHaveClass('h-9', 'w-9');
    fireEvent.click(review);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Sessions' })).toHaveTextContent(context.trim());
    expect(within(dialog).getByText(context.trim())).toBeVisible();
    expect(within(dialog).getAllByText(/Mixed source bounds/).length).toBeGreaterThan(0);
    fireEvent.keyDown(dialog, { key: 'Escape' });
  });
});
