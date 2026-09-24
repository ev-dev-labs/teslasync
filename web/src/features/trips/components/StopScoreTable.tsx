import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { DataTable, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type { ScoredStop } from '@/api/hooks/useJourney';
import { safeArray } from '@/lib/safeArray';

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
          {safeArray(row.evidence).map((line) => (
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
          <Text as="span" variant="caption" className="tabular-nums">
            {fmtNumber(row.score, 0)}
          </Text>
        </div>
      ),
    },
    {
      key: 'wait',
      header: t('journey.scoring.col.wait', 'Wait'),
      render: (row) => (
        <Text as="span" className="tabular-nums">
          {row.wait_s == null
            ? '—'
            : t('journey.scoring.min', '{{min}} min', { min: fmtNumber(row.wait_s / 60, 0) })}
        </Text>
      ),
    },
    {
      key: 'price',
      header: t('journey.scoring.col.price', '$/kWh'),
      render: (row) => (
        <Text as="span" className="tabular-nums">
          {row.unit_price == null ? '—' : formatCurrency(row.unit_price, 2)}
        </Text>
      ),
    },
    {
      key: 'health',
      header: t('journey.scoring.col.health', 'Health'),
      render: (row) => (
        <Text as="span" className="tabular-nums">
          {row.health == null ? '—' : fmtNumber(row.health, 0)}
        </Text>
      ),
    },
    {
      key: 'corridor',
      header: t('journey.scoring.col.corridor', 'Off route'),
      render: (row) => (
        <Text as="span" className="tabular-nums">
          {units.formatDistance(row.corridor_m)}
        </Text>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      mobileColumns={['stop', 'score', 'wait']}
      data={safeArray(stops)}
      keyExtractor={(row) => row.site}
      tableId={tableId}
    />
  );
}
