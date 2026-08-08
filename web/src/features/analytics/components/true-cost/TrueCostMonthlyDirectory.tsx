import { useMemo } from 'react';
import { ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DataTable, type Column, Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { TcoMonthlyDirectoryRow, TcoMonthlyDisposition } from '../../lib/trueCost';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

function dispositionLabel(
  value: TcoMonthlyDisposition,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const labels: Record<TcoMonthlyDisposition, string> = {
    invalid_row: t('tco.directory.invalidRow', 'Invalid row'),
    invalid_month: t('tco.directory.invalidMonth', 'Invalid YYYY-MM'),
    duplicate_month: t('tco.directory.duplicateMonth', 'Duplicate month'),
    eligible: t('tco.directory.eligible', 'Eligible'),
  };
  return labels[value];
}

export function TrueCostMonthlyDirectory({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const columns = useMemo<Column<TcoMonthlyDirectoryRow>[]>(() => [
    {
      key: 'source',
      header: t('tco.directory.sourceRow', 'Source row'),
      render: (row) => <Text variant="caption" mono>{row.sourceIndex + 1}</Text>,
      visibleOnMobile: true,
    },
    {
      key: 'month',
      header: t('tco.columns.month', 'Month'),
      render: (row) => (
        <Text variant="bodySm">
          {row.month ? display.formatMonth(row.month) : '—'}
        </Text>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'disposition',
      header: t('tco.directory.disposition', 'Disposition'),
      render: (row) => (
        <Badge variant={row.disposition === 'eligible' ? 'success' : 'warning'}>
          {dispositionLabel(row.disposition, t)}
        </Badge>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'evCost',
      header: t('tco.columns.evCost', 'Recorded EV cost'),
      render: (row) => (
        <Text variant="bodySm" mono>{display.formatCurrency(row.evCost.value)}</Text>
      ),
      align: 'right',
    },
    {
      key: 'gasCost',
      header: t('tco.columns.gasCost', 'Modeled gas equivalent'),
      render: (row) => (
        <Text variant="bodySm" mono>{display.formatCurrency(row.gasCost.value)}</Text>
      ),
      align: 'right',
    },
    {
      key: 'energy',
      header: t('tco.columns.energy', 'Recorded-cost energy'),
      render: (row) => (
        <Text variant="bodySm" mono>{display.formatEnergy(row.energyWh.value)}</Text>
      ),
      align: 'right',
    },
    {
      key: 'apiSavings',
      header: t('tco.directory.apiSavings', 'API savings'),
      render: (row) => (
        <Text variant="bodySm" mono>{display.formatSignedCurrency(row.apiSavings.value)}</Text>
      ),
      align: 'right',
    },
    {
      key: 'apiCumulative',
      header: t('tco.directory.apiCumulative', 'API cumulative'),
      render: (row) => (
        <Text variant="bodySm" mono>{display.formatSignedCurrency(row.apiCumulative.value)}</Text>
      ),
      align: 'right',
    },
    {
      key: 'derivedDelta',
      header: t('tco.columns.derivedDelta', 'Derived fuel delta'),
      render: (row) => (
        <Text variant="bodySm" mono>{display.formatSignedCurrency(row.derivedFuelDelta)}</Text>
      ),
      align: 'right',
    },
  ], [display, t]);

  return (
    <section
      data-testid="tco-monthly-directory"
      aria-label={t('tco.directory.aria', 'Privacy-safe monthly evidence directory')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.directory.title', 'Monthly evidence directory')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('tco.directory.subtitle', 'Every runtime row receives one terminal disposition; each numeric field is validated independently.')}
        </Text>
        <TrueCostSectionBody state={state}>
          <DataTable
            tableId="analytics:true-cost-monthly-evidence"
            columns={columns}
            data={[...analysis.monthly]}
            keyExtractor={(row) => row.sourceIndex}
            density="compact"
            pagination={{ defaultPageSize: 12, pageSizeOptions: [12, 24, 48] }}
            mobileColumns={['source', 'month', 'disposition']}
            emptyMessage={t('tco.directory.empty', 'No monthly positive-cost rows were returned.')}
          />
        </TrueCostSectionBody>
      </GlassPanel>
    </section>
  );
}
