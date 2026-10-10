import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { DataTable, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import type { Column } from '@/components/ui';

import type { ScoredStop } from '@/api/hooks/useJourney';
import { safeArray } from '@/lib/safeArray';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * Ranked stop table shared by initial scoring and replans: identical
 * columns (stop, score, wait, price, health, corridor) so both
 * rankings read the same.
 */
export function StopScoreTable({ stops, tableId }: { stops: ScoredStop[]; tableId: string }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const units = useUnits();
  const { formatCurrency } = useFormatting();

  const columns: Column<ScoredStop>[] = [
    {
      key: 'stop',
      filterValue: (row) => row.site ?? null,
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
      align: 'right',
      filterValue: (row) => row.score ?? null,
      filterValueLabel: (_, row) => fmtNumber(row.score),
      header: t('journey.scoring.col.score', 'Score'),
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <MetricBar
              value={row.score}
              max={100}
              color="var(--color-emerald-400, #34d399)"
              fill="solid"
              size="slim"
              showHeader={false}
              ariaLabel={t('journey.scoring.scoreFor', 'Score for {{site}}', { site: row.site })}
            />
          </div>
          <Text as="span" variant="caption" className="tabular-nums">
            {fmtNumber(row.score)}
          </Text>
        </div>
      ),
    },
    {
      key: 'wait',
      align: 'right',
      filterValue: (row) => row.wait_s ?? null,
      filterValueLabel: (_, row) => row.wait_s == null ? '—' : t('journey.scoring.min', '{{min}} min', { min: fmtNumber(row.wait_s / 60) }),
      header: t('journey.scoring.col.wait', 'Wait'),
      render: (row) => (
        <Text as="span" className="tabular-nums">
          {row.wait_s == null
            ? '—'
            : t('journey.scoring.min', '{{min}} min', { min: fmtNumber(row.wait_s / 60) })}
        </Text>
      ),
    },
    {
      key: 'price',
      align: 'right',
      filterValue: (row) => row.unit_price ?? null,
      filterValueLabel: (_, row) => row.unit_price == null ? '—' : formatCurrency(row.unit_price),
      header: t('journey.scoring.col.price', '$/kWh'),
      render: (row) => (
        <Text as="span" className="tabular-nums">
          {row.unit_price == null ? '—' : formatCurrency(row.unit_price)}
        </Text>
      ),
    },
    {
      key: 'health',
      align: 'right',
      filterValue: (row) => row.health ?? null,
      filterValueLabel: (_, row) => row.health == null ? '—' : fmtNumber(row.health),
      header: t('journey.scoring.col.health', 'Health'),
      render: (row) => (
        <Text as="span" className="tabular-nums">
          {row.health == null ? '—' : fmtNumber(row.health)}
        </Text>
      ),
    },
    {
      key: 'corridor',
      align: 'right',
      filterValue: (row) => row.corridor_m ?? null,
      filterValueLabel: (_, row) => units.formatDistance(row.corridor_m),
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
      enableValueFilters
      columns={columns}
      mobileColumns={['stop', 'score', 'wait']}
      data={safeArray(stops)}
      keyExtractor={(row) => row.site}
      tableId={tableId}
    />
  );
}
