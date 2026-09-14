import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { DataTable, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type { ScoredStop } from '@/api/hooks/useJourney';

/**
 * Ranked stop table shared by initial scoring and replans: identical
 * columns (stop, score, wait, price, health, corridor) so both
 * rankings read the same.
 */
export function StopScoreTable({ stops, tableId }: { stops: ScoredStop[]; tableId: string }) {
  const { t } = useTranslation();
  const units = useUnits();
  const { formatCurrency } = useFormatting();

  const columns: Column<ScoredStop>[] = [
    {
      key: 'stop',
      header: t('journey.scoring.col.stop', 'Stop'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.site}
          </Text>
          {row.evidence.map((line) => (
            <Text as="p" key={line} variant="caption">
              {line}
            </Text>
          ))}
        </div>
      ),
    },
    {
      key: 'score',
      header: t('journey.scoring.col.score', 'Score'),
      render: (row) => (
        <div className="flex min-w-[6rem] items-center gap-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-emerald-400/70"
              style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
            />
          </div>
          <span className="tabular-nums text-xs">{fmtNumber(row.score, 0)}</span>
        </div>
      ),
    },
    {
      key: 'wait',
      header: t('journey.scoring.col.wait', 'Wait'),
      render: (row) => (
        <span className="tabular-nums">
          {row.wait_s == null
            ? '—'
            : t('journey.scoring.min', '{{min}} min', { min: fmtNumber(row.wait_s / 60, 0) })}
        </span>
      ),
    },
    {
      key: 'price',
      header: t('journey.scoring.col.price', '$/kWh'),
      render: (row) => (
        <span className="tabular-nums">
          {row.per_kwh == null ? '—' : formatCurrency(row.per_kwh, 2)}
        </span>
      ),
    },
    {
      key: 'health',
      header: t('journey.scoring.col.health', 'Health'),
      render: (row) => (
        <span className="tabular-nums">
          {row.health == null ? '—' : fmtNumber(row.health, 0)}
        </span>
      ),
    },
    {
      key: 'corridor',
      header: t('journey.scoring.col.corridor', 'Off route'),
      render: (row) => (
        <span className="tabular-nums">{units.formatDistance(row.corridor_m)}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={stops}
      keyExtractor={(row) => row.site}
      tableId={tableId}
    />
  );
}
