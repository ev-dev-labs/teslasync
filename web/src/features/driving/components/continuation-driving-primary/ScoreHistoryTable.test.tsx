import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { DataTable } from '@/components/ui';
import type { HistoryRow } from '../../pages/DriveScorePage';
import { ScoreHistoryTable } from './ScoreHistoryTable';
import { formatDateShort } from '@/lib/dateFormat';
import { createHistoryColumns } from '../score-orchestrator/scoreHistoryColumns';
import i18n from '@/i18n';

type HistoryTableProps = ComponentProps<typeof DataTable<HistoryRow>>;
const table = vi.hoisted(() => {
  const value: { props: HistoryTableProps | null; real: boolean } = { props: null, real: false };
  return value;
});

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, DataTable: (props: HistoryTableProps) => {
    table.props = props;
    return table.real ? <actual.DataTable {...props} /> : null;
  } };
});

afterEach(() => {
  cleanup();
  table.real = false;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('ScoreHistoryTable preservation contract', () => {
  it('forwards all loaded rows rather than a ten-row page and exports every canonical fact', () => {
    const rows: HistoryRow[] = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1, ts: '2026-10-01T12:00:00Z', route: `Route ${index}`,
      distanceM: 40_000, durationS: index === 24 ? null : 3600, whPerKm: 180,
      total: 80, grade: 'A', efficiency: 30, smoothness: 20, speed: 30,
    }));
    const onSort = vi.fn();
    const columns = createHistoryColumns(i18n.t, value => `${value} m`, value => `${value} Wh/km`);
    render(<ScoreHistoryTable rows={rows} columns={columns} sortKey="date" sortDir="desc" onSort={onSort} />);
    expect(table.props?.data).toBe(rows);
    expect(table.props?.columns).toBe(columns);
    expect(table.props?.columns.map(column => column.key)).toEqual([
      'date', 'route', 'distance', 'duration', 'efficiency', 'score', 'grade', 'breakdown',
    ]);
    expect(table.props).toMatchObject({
      tableId: 'driving:drive-score-history', sortKey: 'date', sortDir: 'desc',
      mobileColumns: ['date', 'score', 'grade'], exportable: true,
      exportFilename: 'drive-score-history', pagination: { defaultPageSize: 10 },
    });
    expect(table.props?.exportRow?.(rows[24])).toEqual({
      drive_id: 25, occurred_at: '2026-10-01T12:00:00Z', route: 'Route 24',
      distance_m: 40_000, duration_s: null, wh_per_km: 180, score: 80, grade: 'A',
      efficiency: 30, smoothness: 20, speed: 30,
    });
    expect(table.props?.mobilePresentation?.roles).toEqual({
      date: 'title', score: 'primary', grade: 'badge',
    });
    expect(table.props?.mobilePresentation?.displayValue(rows[0], 'date')).toBe(formatDateShort(rows[0].ts));
    expect(table.props?.mobilePresentation?.displayValue(rows[0], 'score')).toBe('80/100');
    expect(table.props?.mobilePresentation?.displayValue(rows[0], 'grade')).toBe('A');
    expect(table.props?.mobilePresentation?.canShowField).toBeUndefined();
    expect(table.props?.mobilePresentation?.onOpenRow).toBeUndefined();
    table.props?.onSort?.('score');
    expect(onSort).toHaveBeenCalledWith('score');
  });

  it('opens all eight original fields from the mobile summary with keyboard and restores desktop columns', async () => {
    table.real = true;
    const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.push({ element, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
    const resize = (width: number) => act(() => {
      observers.forEach(({ element, callback }) => callback(
        [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
      ));
    });
    const row: HistoryRow = {
      id: 1, ts: '2026-10-01T12:00:00Z', route: 'Start to destination',
      distanceM: 40_000, durationS: null, whPerKm: 180, total: 80,
      grade: 'A', efficiency: 30, smoothness: 20, speed: 30,
    };
    const columns = createHistoryColumns(i18n.t, value => `${value} m`, value => `${value} Wh/km`);
    const onSort = vi.fn();
    render(<ScoreHistoryTable rows={[row]} columns={columns} sortKey="date" sortDir="desc" onSort={onSort} />);
    resize(375);
    const user = userEvent.setup();
    const quickView = screen.getByRole('button', { name: 'Quick view' });
    expect(quickView).toHaveClass('min-h-11', 'min-w-11');
    quickView.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelectorAll('dt')).toHaveLength(8);
    for (const column of columns) expect(within(dialog).getByText(column.header)).toBeInTheDocument();
    for (const value of ['Start to destination', '40000 m', '180 Wh/km', '80/100', '30/20/30', '—']) {
      expect(within(dialog).getByText(value)).toBeInTheDocument();
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(quickView).toHaveFocus());
    await user.keyboard(' ');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    resize(1440);
    const desktop = screen.getByRole('table');
    for (const column of columns) expect(within(desktop).getByText(column.header)).toBeInTheDocument();
  });
});
