import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { DataTable, Column } from '@/components/ui';
import type { HistoryRow } from '../../pages/DriveScorePage';
import { ScoreHistoryTable } from './ScoreHistoryTable';

type HistoryTableProps = ComponentProps<typeof DataTable<HistoryRow>>;
const table = vi.hoisted(() => {
  const value: { props: HistoryTableProps | null } = { props: null };
  return value;
});

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, DataTable: (props: HistoryTableProps) => { table.props = props; return null; } };
});

describe('ScoreHistoryTable preservation contract', () => {
  it('forwards all loaded rows rather than a ten-row page and exports every canonical fact', () => {
    const rows: HistoryRow[] = Array.from({ length: 25 }, (_, index) => ({
      id: index + 1, ts: '2026-10-01T12:00:00Z', route: `Route ${index}`,
      distanceM: 40_000, durationS: index === 24 ? null : 3600, whPerKm: 180,
      total: 80, grade: 'A', efficiency: 30, smoothness: 20, speed: 30,
    }));
    const onSort = vi.fn();
    const columns: Column<HistoryRow>[] = [{ key: 'date', header: 'Date', render: (row) => row.ts }];
    render(<ScoreHistoryTable rows={rows} columns={columns} sortKey="date" sortDir="desc" onSort={onSort} />);
    expect(table.props?.data).toBe(rows);
    expect(table.props?.columns).toBe(columns);
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
    table.props?.onSort?.('score');
    expect(onSort).toHaveBeenCalledWith('score');
  });
});
