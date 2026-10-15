import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '@/components/ui';
import { formatDateShort } from '@/lib/dateFormat';
import type { HistoryRow } from '../../pages/DriveScorePage';

interface ScoreHistoryTableProps {
  rows: HistoryRow[];
  columns: Column<HistoryRow>[];
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
}

export function ScoreHistoryTable({ rows, columns, sortKey, sortDir, onSort }: ScoreHistoryTableProps) {
  const { t } = useTranslation();
  return (
    <DataTable
      tableId="driving:drive-score-history"
      columns={columns}
      data={rows}
      keyExtractor={(row) => row.id}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      mobileColumns={['date', 'score', 'grade']}
      mobilePresentation={{
        roles: { date: 'title', score: 'primary', grade: 'badge' },
        displayValue: (row, key) => {
          switch (key) {
            case 'date': return formatDateShort(row.ts);
            case 'score': return `${row.total}/100`;
            case 'grade': return row.grade;
            default: return null;
          }
        },
      }}
      exportable
      exportFilename="drive-score-history"
      exportRow={(row) => ({
        drive_id: row.id,
        occurred_at: row.ts,
        route: row.route,
        distance_m: row.distanceM,
        duration_s: row.durationS,
        wh_per_km: row.whPerKm,
        score: row.total,
        grade: row.grade,
        efficiency: row.efficiency,
        smoothness: row.smoothness,
        speed: row.speed,
      })}
      emptyMessage={t('driveScore.noDrives', 'No drives found for the selected period.')}
      pagination={{ defaultPageSize: 10 }}
    />
  );
}
