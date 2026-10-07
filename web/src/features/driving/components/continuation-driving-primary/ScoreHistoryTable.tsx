import { useTranslation } from 'react-i18next';
import { DataTable, type Column } from '@/components/ui';
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
