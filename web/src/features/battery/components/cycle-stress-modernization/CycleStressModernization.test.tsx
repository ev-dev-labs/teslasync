import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { analyzeCycleStress } from '../../lib/cycleStress';
import type { ChargingSession } from '@/types/charging';
import { CycleStressSummary } from './CycleStressSummary';
import { CycleStressDirectory } from './CycleStressDirectory';
import { CycleStressAccounting } from './CycleStressAccounting';
import { cycleStressQueryState, type CycleStressTrust } from './queryState';

// Keep all motion exports and preference behavior unless a particular entrance
// is replaced. The tests do not install another animation or router owner.
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: { children: ReactNode }) => <>{children}</> };
});

const now = Date.parse('2026-08-08T12:00:00Z');
const session: ChargingSession = {
  id: '101', vehicle_id: '7', charger_type: 'AC',
  start_soc_pct: 20, end_soc_pct: 90, total_energy_added_wh: 30_000,
  peak_power_w: null, cost_decimal: null,
  started_at: '2026-07-01T10:00:00Z', ended_at: '2026-07-01T11:00:00Z',
  start_ts: '2026-07-01T10:00:00Z', startedAt: '2026-07-01T10:00:00Z', duration_min: 60,
};
const result = analyzeCycleStress([session], [], now, 'UTC');
const ready = cycleStressQueryState(true, { data: [session], isSuccess: true }, { data: [], isSuccess: true });
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(client);
  return <QueryClientProvider client={queryClient}><ToastProvider>
    <MemoryRouter initialEntries={['/cycle-stress']}>{children}</MemoryRouter>
  </ToastProvider></QueryClientProvider>;
}
function summary(trust: CycleStressTrust) {
  return <CycleStressSummary result={result} trust={trust} locale="en-US"
    deepThresholdPct={60} exponent={1.3}
    onDeepThresholdChange={() => {}} onExponentChange={() => {}} />;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('cycle-stress source-preserving presentation', () => {
  it('opens the real review drawer with bounded source scope and illustrative stress assumptions', () => {
    const before = JSON.stringify(result);
    render(summary(ready), { wrapper: Provider });
    fireEvent.click(within(screen.getByTestId('cycle-stress-kpis')).getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('illustrative exponent 1.3')).toBeVisible();
    expect(drawer.getByText('sum of count x depth fraction')).toBeVisible();
    expect(drawer.getByText(/not a selected-date-window or full-history total/)).toBeVisible();
    expect(JSON.stringify(result)).toBe(before);
  });

  it('renders six compact metrics with honest bounded period and specialist formatting', () => {
    const { container } = render(summary(ready), { wrapper: Provider });
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelector('[data-battery-period]')).toHaveTextContent('Returned vehicle histories · bounded evidence');
    expect(screen.getByText(/not a selected-date-window or full-history total/)).toBeInTheDocument();
    expect(container.querySelector('[data-battery-detail-context]')).toHaveTextContent('1 total rows returned');
    expect(screen.getByRole('combobox', { name: 'Deep-cycle lens' })).toHaveAttribute('id', 'cycle-stress-threshold');
    expect(screen.getByRole('combobox', { name: 'Depth exponent' })).toHaveAttribute('id', 'cycle-stress-exponent');
    expect(container.querySelector('#cycle-stress-summary [data-operational-brief]')).not.toBeNull();
  });
  it('retains a persistent Router and metric values on a failed background refresh', () => {
    const retryCharging = vi.fn();
    const retryDrive = vi.fn();
    const view = render(summary(ready), { wrapper: Provider });
    const values = Array.from(view.container.querySelectorAll('[data-operational-value]'), node => node.textContent);
    const retained = cycleStressQueryState(true, {
      data: [session], error: new Error('private technical failure'), isError: true, refetch: retryCharging,
    }, { data: [], isSuccess: true, refetch: retryDrive });
    view.rerender(summary(retained));
    expect(Array.from(view.container.querySelectorAll('[data-operational-value]'), node => node.textContent)).toEqual(values);
    expect(screen.getByRole('alert')).toHaveTextContent(/most recently loaded evidence/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Charging history' }));
    expect(retryCharging).toHaveBeenCalledTimes(1);
    expect(retryDrive).not.toHaveBeenCalled();
    expect(screen.queryByText('private technical failure')).not.toBeInTheDocument();
  });
  it('shows friendly fatal alerts with separately targeted source recovery, not raw errors', () => {
    const chargingRetry = vi.fn();
    const driveRetry = vi.fn();
    const fatal = cycleStressQueryState(true,
      { error: new Error('private charging stack'), isError: true, refetch: chargingRetry },
      { error: new Error('private drive stack'), isError: true, refetch: driveRetry });
    const { container } = render(summary(fatal), { wrapper: Provider });
    const charging = within(screen.getByRole('region', { name: 'Charging history' }));
    expect(charging.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(charging.getByRole('button', { name: 'Retry Charging history' }));
    expect(chargingRetry).toHaveBeenCalledTimes(1);
    expect(driveRetry).not.toHaveBeenCalled();
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(6);
    expect(screen.queryByText('private charging stack')).not.toBeInTheDocument();
    expect(screen.queryByText('private drive stack')).not.toBeInTheDocument();
  });
  it('keeps failed source accounting unknown and all categories visible', () => {
    const partial = cycleStressQueryState(true, { error: new Error('failed'), isError: true },
      { data: [], isSuccess: true });
    render(<CycleStressAccounting result={analyzeCycleStress([], [], now, 'UTC')}
      state={partial.state} locale="en-US" />, { wrapper: Provider });
    const table = within(screen.getByTestId('cycle-stress-accounting'));
    expect(table.getByText('Missing SoC endpoint')).toBeInTheDocument();
    expect(table.getByText('Overlapping interval')).toBeInTheDocument();
    expect(table.getAllByText('—')).toHaveLength(8);
  });
  it('uses the real mobile table pipeline and exposes all nine directory fields in quick view', async () => {
    class NarrowObserver implements ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element): void {
        this.callback([{
          target, contentRect: { width: 375, height: 200 },
          contentBoxSize: [{ inlineSize: 375, blockSize: 200 }],
          borderBoxSize: [{ inlineSize: 375, blockSize: 200 }],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry], this);
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', NarrowObserver);
    const view = render(<CycleStressDirectory result={result} state={ready.state} locale="en-US" />,
      { wrapper: Provider });
    await act(async () => {});
    expect(view.container.querySelector('[data-mobile-table]')).not.toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0]!);
    const dialog = within(screen.getByRole('dialog'));
    for (const field of ['Closed / observed', 'Depth', 'Mean SoC', 'Closure', 'Closure duration',
      'Range sources', 'EFC', 'Depth index', 'Segment']) {
      expect(dialog.getByText(field)).toBeInTheDocument();
    }
    const footer = screen.getByRole('dialog').querySelector('[data-modal-footer]');
    expect(footer).not.toBeNull();
    fireEvent.click(within(footer as HTMLElement).getByRole('button', { name: 'Close', exact: true }));
  });
});
