import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DataTable, type Column } from '@/components/ui';
import { sessionPresentation } from './sessionPresentation';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDateTime } from '@/lib/dateFormat';

const row = {
  started_at: '2025-06-03T20:00:00Z', ended_at: '2025-06-04T02:00:00Z',
  duration_hours: 6, start_battery_pct: 90, end_battery_pct: 84,
  drain_pct: 6, drain_pct_per_day: 8, ambient_temp_c_avg: null,
};

function Fixture() {
  const { t } = useTranslation();
  const { formatTemperature } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const columns: Column<typeof row>[] = [
    { key: 'started_at', header: 'Started', sortable: true, render: value => formatDateTime(value.started_at) },
    { key: 'duration_hours', header: 'Duration', render: value => `${fmtNumber(value.duration_hours)}h` },
    { key: 'start_battery_pct', header: 'Start %', render: value => `${fmtNumber(value.start_battery_pct)}%` },
    { key: 'end_battery_pct', header: 'End %', render: value => `${fmtNumber(value.end_battery_pct)}%` },
    { key: 'drain_pct', header: 'Loss %', render: value => `${fmtNumber(value.drain_pct)}%` },
    { key: 'drain_pct_per_day', header: 'Rate %/day', render: value => fmtNumber(value.drain_pct_per_day) },
    { key: 'ambient_temp_c_avg', header: 'Ambient', render: value => formatTemperature(value.ambient_temp_c_avg) },
  ];
  return <DataTable tableId="battery:vampire-drain-sessions" caption="Drain sessions"
    columns={columns} data={[row]} keyExtractor={value => value.started_at}
    mobilePresentation={sessionPresentation(fmtNumber, formatTemperature, t)} pagination />;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('real DataTable mobile drain details — authored, NOTRUN', () => {
  it('keeps all columns and the end timestamp reachable at a narrow allocated width', async () => {
    const observers: Array<{ callback: ResizeObserverCallback; target: Element }> = [];
    class NarrowObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { observers.push({ callback: this.callback, target }); }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NarrowObserver);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><Fixture /></QueryClientProvider></MemoryRouter>);
    act(() => {
      for (const observer of observers) {
        observer.callback([{
          target: observer.target, contentRect: { width: 375, height: 500 },
        } as ResizeObserverEntry], {} as ResizeObserver);
      }
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog', { name: 'Drain sessions' });
    for (const label of ['Started', 'Duration', 'Start %', 'End %', 'Loss %', 'Rate %/day', 'Ambient', 'Ended']) {
      expect(within(dialog).getByText(label, { exact: true })).toBeInTheDocument();
    }
    expect(within(dialog).getByText('90.00%')).toBeInTheDocument();
    expect(within(dialog).getByText('84.00%')).toBeInTheDocument();
    expect(within(dialog).getByText('—')).toBeInTheDocument();
    expect(within(dialog).getByText(formatDateTime(row.ended_at))).toBeInTheDocument();
    // Modal has a header close icon and a footer action: deliberately select the footer.
    const footer = dialog.querySelector('[data-modal-footer]');
    expect(footer).not.toBeNull();
    fireEvent.click(within(footer as HTMLElement).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(row.ambient_temp_c_avg).toBeNull();
  });
});
