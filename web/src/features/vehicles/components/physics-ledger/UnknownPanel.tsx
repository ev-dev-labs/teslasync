import type {
  PhysicsLedger
} from '@/api/types';
import { Badge, DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { asList, useT } from './helpers';

export function UnknownPanel({ ledger }: { ledger: PhysicsLedger }) {
  const t = useT();
  const { formatDuration } = useUnits();
  const intervals = asList(ledger.unknown_intervals);
  const columns: Column<(typeof intervals)[number]>[] = [
    { key: 'start', header: t('physicsLedger.unknown.start', 'Start'), render: (row) => formatDateTime(row.started_at) },
    { key: 'end', header: t('physicsLedger.unknown.end', 'End'), render: (row) => formatDateTime(row.ended_at) },
    {
      key: 'duration',
      header: t('physicsLedger.unknown.duration', 'Duration'),
      render: (row) => formatDuration(row.duration_s),
    },
    { key: 'reason', header: t('physicsLedger.unknown.reason', 'Reason'), render: (row) => row.reason },
  ];
  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="ledger-unknown">
      <PanelTitle>{t('physicsLedger.unknown.title', 'Unknown budget')}</PanelTitle>
      <div className="flex flex-wrap gap-2">
        <Badge variant={ledger.unknown_hours > 0 ? 'warning' : 'success'} size="sm">
          {t('physicsLedger.unknown.hours', 'Unknown hours')}: {fmtNumber(ledger.unknown_hours, 2)}
        </Badge>
        {ledger.truncated ? (
          <Badge variant="danger" size="sm">
            {t('physicsLedger.truncated', 'Sample cap hit — oldest prefix solved')}
          </Badge>
        ) : null}
      </div>
      {intervals.length === 0 ? (
        <Text as="p" size="sm" color="secondary">
          {t('physicsLedger.unknown.empty', 'Full coverage: no gaps in this window.')}
        </Text>
      ) : (
        <DataTable
          tableId="physics-ledger:unknown"
          columns={columns}
          data={intervals}
          keyExtractor={(row) => `${row.started_at}-${row.ended_at}`}
          emptyMessage={t('physicsLedger.unknown.empty', 'Full coverage: no gaps in this window.')}
          pagination={{ defaultPageSize: 10, pageSizeOptions: [10, 25, 50] }}
        />
      )}
    </GlassPanel>
  );
}
