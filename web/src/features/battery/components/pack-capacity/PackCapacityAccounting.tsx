import { useMemo } from 'react';
import {
  CircleCheck,
  CircleSlash2,
  Database,
  Rows3,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import {
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import type {
  PackCapacityResult,
  PackCapacityRowCategory,
} from '../../lib/packCapacity';
import {
  packCapacityNumber,
  packCapacityPercent,
} from './labels';
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacityAccountingProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
}

interface AccountingRow {
  key: PackCapacityRowCategory;
  label: string;
  count: number;
}

export function PackCapacityAccounting({
  result,
  state,
  locale,
}: PackCapacityAccountingProps) {
  const { t } = useTranslation();
  const accounting = result.accounting;
  const rows = useMemo<AccountingRow[]>(
    () => [
      {
        key: 'included',
        label: t('packCapacity.accounting.included', 'Included'),
        count: accounting.categories.included,
      },
      {
        key: 'incomplete_live',
        label: t(
          'packCapacity.accounting.incomplete',
          'Incomplete / live (no explicit completion)',
        ),
        count: accounting.categories.incomplete_live,
      },
      {
        key: 'invalid_timestamp_order',
        label: t(
          'packCapacity.accounting.invalidTime',
          'Invalid timestamp or order',
        ),
        count: accounting.categories.invalid_timestamp_order,
      },
      {
        key: 'future',
        label: t(
          'packCapacity.accounting.future',
          'Future-dated completion',
        ),
        count: accounting.categories.future,
      },
      {
        key: 'missing_soc',
        label: t(
          'packCapacity.accounting.missingSoc',
          'Missing SoC endpoint',
        ),
        count: accounting.categories.missing_soc,
      },
      {
        key: 'invalid_soc',
        label: t(
          'packCapacity.accounting.invalidSoc',
          'Invalid SoC endpoint',
        ),
        count: accounting.categories.invalid_soc,
      },
      {
        key: 'nonpositive_soc_gain',
        label: t(
          'packCapacity.accounting.nonpositiveGain',
          'Nonpositive SoC gain',
        ),
        count: accounting.categories.nonpositive_soc_gain,
      },
      {
        key: 'missing_energy',
        label: t(
          'packCapacity.accounting.missingEnergy',
          'Missing energy',
        ),
        count: accounting.categories.missing_energy,
      },
      {
        key: 'invalid_energy',
        label: t(
          'packCapacity.accounting.invalidEnergy',
          'Invalid or nonpositive energy',
        ),
        count: accounting.categories.invalid_energy,
      },
      {
        key: 'below_soc_window',
        label: t(
          'packCapacity.accounting.belowWindow',
          'Below selected SoC window',
        ),
        count: accounting.categories.below_soc_window,
      },
      {
        key: 'implausible_capacity',
        label: t(
          'packCapacity.accounting.implausible',
          'Implausible implied capacity',
        ),
        count: accounting.categories.implausible_capacity,
      },
      {
        key: 'duplicate_session',
        label: t(
          'packCapacity.accounting.duplicate',
          'Duplicate session identifier',
        ),
        count: accounting.categories.duplicate_session,
      },
      {
        key: 'overlapping_interval',
        label: t(
          'packCapacity.accounting.overlap',
          'Overlapping interval',
        ),
        count: accounting.categories.overlapping_interval,
      },
      {
        key: 'outside_analysis_cap',
        label: t(
          'packCapacity.accounting.outsideCap',
          'Outside analysis cap',
        ),
        count: accounting.categories.outside_analysis_cap,
      },
    ],
    [accounting.categories, t],
  );
  const columns = useMemo<Column<AccountingRow>[]>(
    () => [
      {
        key: 'category',
        header: t(
          'packCapacity.accounting.category',
          'Primary category',
        ),
        visibleOnMobile: true,
        render: (row) => <Text variant="bodySm">{row.label}</Text>,
      },
      {
        key: 'count',
        header: t('packCapacity.accounting.rows', 'Rows'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {packCapacityNumber(row.count, locale, 0)}
          </Text>
        ),
      },
      {
        key: 'share',
        header: t('packCapacity.accounting.share', 'Returned share'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {packCapacityPercent(
              accounting.returnedRows > 0
                ? row.count / accounting.returnedRows
                : 0,
              locale,
            )}
          </Text>
        ),
      },
    ],
    [accounting.returnedRows, locale, t],
  );
  const exclusionShare =
    accounting.returnedRows > 0
      ? accounting.excludedRows / accounting.returnedRows
      : 0;

  return (
    <section data-testid="pack-capacity-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Database
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'packCapacity.accounting.title',
            'Source-row accounting',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'packCapacity.accounting.subtitle',
            'Every returned charging row enters exactly one primary category before filtering.',
          )}
        </Text>
        <PackCapacitySectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={t(
                'packCapacity.accounting.returned',
                'Rows returned',
              )}
              value={packCapacityNumber(
                accounting.returnedRows,
                locale,
                0,
              )}
              subtitle={t(
                'packCapacity.accounting.requested',
                'up to {{limit}} requested',
                { limit: accounting.historyLimit },
              )}
              icon={<Rows3 className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'packCapacity.accounting.accepted',
                'Qualified measurements',
              )}
              value={packCapacityNumber(
                accounting.includedRows,
                locale,
                0,
              )}
              subtitle={t(
                'packCapacity.accounting.afterValidation',
                'after all validation and cap rules',
              )}
              icon={<CircleCheck className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'packCapacity.accounting.excluded',
                'Excluded rows',
              )}
              value={packCapacityNumber(
                accounting.excludedRows,
                locale,
                0,
              )}
              subtitle={t(
                'packCapacity.accounting.primaryReason',
                'one primary reason per row',
              )}
              icon={<CircleSlash2 className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'packCapacity.accounting.exclusionShare',
                'Excluded share',
              )}
              value={packCapacityPercent(exclusionShare, locale)}
              subtitle={t(
                'packCapacity.accounting.ofReturned',
                'of known returned rows',
              )}
              icon={<Database className="h-5 w-5" />}
              color="red"
            />
          </div>
          <DataTable
            tableId="battery:pack-capacity-accounting"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['category', 'count']}
            emptyMessage={t(
              'packCapacity.accounting.empty',
              'No accounting categories are available.',
            )}
          />
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'packCapacity.accounting.invariant',
                '{{returned}} returned = {{included}} included + {{excluded}} excluded. Missing completion times are never synthesized, and missing SoC or energy is never imputed.',
                {
                  returned: accounting.returnedRows,
                  included: accounting.includedRows,
                  excluded: accounting.excludedRows,
                },
              )}
            </Text>
          </AlertBanner>
        </PackCapacitySectionBody>
      </GlassPanel>
    </section>
  );
}
