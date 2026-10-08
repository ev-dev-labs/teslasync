import { cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { DataState } from '@/api/dataState';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';
import { MapsOperationalBrief } from './MapsOperationalBrief';

afterEach(cleanup);

const scope = 'Vehicle 7 · latest 50 positions, not a complete route window';
const sourceLabel = 'Latest position';
const state = deriveDataState({
  data: { speed: 0 },
  error: new Error('refresh failed'),
  dataUpdatedAt: Date.parse('2026-10-06T20:00:00Z'),
}, { provenance: 'live' });
const metrics = [
  { metricId: 'speed', occurrenceId: 'speed', rawValue: 0, label: 'Measured speed', description: 'Zero means measured stationary.', display: { formatter: (raw: number) => ({ value: `${raw.toFixed(2)} km/h`, unit: '' }) } },
  { metricId: 'number', occurrenceId: 'heading', rawValue: undefined, label: 'Heading', description: 'Heading is not reported.' },
  { metricId: 'count', occurrenceId: 'history-count', rawValue: 50, label: 'Loaded positions', description: scope, context: <a href="#/maps/navigation-route">Navigation route</a> },
] as const satisfies readonly StatMetric[];

function renderBrief(loading = false, sources: readonly { label: string; state: DataState<unknown> }[] = [{ label: sourceLabel, state }], onRetry?: () => void) {
  return render(
    <MemoryRouter>
      <MapsOperationalBrief title="Vehicle status" description="Independent position evidence"
        scope={scope} metrics={metrics} sources={sources} loading={loading} onRetry={onRetry} />
    </MemoryRouter>,
  );
}

describe('maps OperationalBrief source contract', () => {
  it('retains measured zero and missing heading with real source status and original bounds', () => {
    const { container } = renderBrief();
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(band).toHaveAttribute('data-operational-brief');
    expect(container.querySelector('[data-operational-metric="speed"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="heading"]')).toHaveAttribute('data-value-state', 'missing');
    expect(within(band).getByText('0.00 km/h')).toBeInTheDocument();
    expect(within(band).getByText('Retained source data')).toBeInTheDocument();
    expect(within(band).getAllByText(scope).length).toBeGreaterThan(0);
  });

  it('opens the real Review details drawer and retains rich context, links and numeric evidence', () => {
    renderBrief();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Vehicle status details' });
    expect(within(drawer).getByText('0.00 km/h')).toBeInTheDocument();
    expect(within(drawer).getByText('Heading is not reported.')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Navigation route' })).toHaveAttribute('href', '#/maps/navigation-route');
    expect(within(drawer).getAllByText(scope)).toHaveLength(2);
  });

  it('withholds values but retains metric labels and context on first loading', () => {
    const { container } = renderBrief(true);
    expect(screen.getByRole('region', { name: 'Vehicle status' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Measured speed')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
  });

  it('preserves raw SI measurements and validates them before invoking a specialist formatter', () => {
    const formatter = vi.fn((raw: number) => ({ value: raw.toFixed(4), unit: '°' }));
    const inputs: readonly StatMetric[] = [
      { metricId: 'number', rawValue: 0, label: 'Heading', display: { formatter } },
      { metricId: 'number', rawValue: Number.NaN, label: 'Invalid heading', display: { formatter } },
      { metricId: 'number', rawValue: null, label: 'Missing heading', display: { formatter } },
      { metricId: 'speed', rawValue: 25, label: 'SI speed' },
    ];
    const { result } = renderHook(() => useOperationalMetrics(inputs));
    expect(result.current.map(({ rawValue }) => rawValue)).toEqual([0, Number.NaN, null, 25]);
    expect(result.current.map(({ valueState }) => valueState)).toEqual(['value', 'invalid', 'missing', 'value']);
    expect(formatter).toHaveBeenCalledOnce();
    expect(formatter.mock.calls[0][0]).toBe(0);
  });

  it.each([
    ['no sources', [], 'Source data unavailable'],
    ['resolved empty', [{ label: sourceLabel, state: deriveDataState({ data: [] }, { unavailable: true }) }], 'Source data unavailable'],
    ['partial payload', [{ label: sourceLabel, state: deriveDataState({ data: { speed: 0 } }, { partial: true }) }], 'Independent sources incomplete'],
    ['first failure', [{ label: sourceLabel, state: deriveDataState({ error: new Error('first load failed') }) }], 'Source data unavailable'],
    ['paused without data', [{ label: sourceLabel, state: deriveDataState({ fetchStatus: 'paused' }) }], 'Source data unavailable'],
  ] as const)('does not fabricate availability or loading for %s', (_case, sources, statusLabel) => {
    const { container } = renderBrief(false, sources);
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(within(band).getByText(statusLabel)).toBeInTheDocument();
    expect(band).not.toHaveAttribute('aria-busy');
    expect(within(band).getByText('0.00 km/h')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(screen.queryByText('Loading source data')).not.toBeInTheDocument();
  });

  it('shows initial loading from source status while preserving labels, scope and retry', () => {
    const onRetry = vi.fn();
    const { container } = renderBrief(false, [{ label: sourceLabel, state: deriveDataState({ isPending: true }) }], onRetry);
    expect(screen.getByText('Loading source data')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vehicle status' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Measured speed')).toBeInTheDocument();
    expect(screen.getAllByText(scope).length).toBeGreaterThan(0);
    expect(screen.getByText(`${sourceLabel}: Receipt time unknown`)).toBeInTheDocument();
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each([
    ['failure', deriveDataState({ error: new Error('history failed') })],
    ['empty', deriveDataState({ data: [] }, { unavailable: true, provenance: 'historical' })],
    ['pending', deriveDataState({ isPending: true })],
  ] as const)('keeps independent metrics and prior receipts when another source is %s', (_case, otherState) => {
    renderBrief(false, [{ label: sourceLabel, state }, { label: 'Route history', state: otherState }]);
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(within(band).getByText('Independent sources incomplete')).toBeInTheDocument();
    expect(within(band).getByText('0.00 km/h')).toBeInTheDocument();
    const receipt = `${sourceLabel}: ${formatDateTime('2026-10-06T20:00:00.000Z')}`;
    expect(within(band).getByText(receipt)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Vehicle status details' });
    expect(within(drawer).getByText(receipt)).toBeInTheDocument();
    expect(within(drawer).getByText(`${sourceLabel}: cached; Route history: ${otherState.provenance}`)).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Navigation route' })).toHaveAttribute('href', '#/maps/navigation-route');
  });

  it.each(['failed', 'paused', 'refreshing', 'healthy'] as const)('preserves retained measurements and provenance during %s refresh', (refresh) => {
    const retainedState = deriveDataState({
      data: { speed: 0 },
      dataUpdatedAt: Date.parse('2026-10-06T20:00:00Z'),
      ...(refresh === 'failed' ? { error: new Error('refresh failed') } : {}),
      ...(refresh === 'paused' ? { fetchStatus: 'paused' as const } : {}),
      ...(refresh === 'refreshing' ? { isFetching: true } : {}),
    }, { provenance: 'live' });
    renderBrief(false, [{ label: sourceLabel, state: retainedState }]);
    const band = screen.getByRole('region', { name: 'Vehicle status' });
    expect(within(band).getByText(refresh === 'failed' || refresh === 'paused' ? 'Retained source data' : 'Source data available')).toBeInTheDocument();
    expect(within(band).getByText('0.00 km/h')).toBeInTheDocument();
    expect(band).not.toHaveAttribute('aria-busy');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog', { name: 'Vehicle status details' })).getByText(`${sourceLabel}: ${retainedState.provenance}`)).toBeInTheDocument();
  });
});
