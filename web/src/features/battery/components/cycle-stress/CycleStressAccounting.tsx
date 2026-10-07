import { useMemo } from 'react';
import {
  BatteryCharging,
  Car,
  CircleCheck,
  CircleSlash2,
  Database,
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
import type { CycleStressResult } from '../../lib/cycleStress';
import { cycleStressNumber } from './labels';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressAccountingProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}

interface AccountingRow {
  key: string;
  label: string;
  drive: number;
  charging: number;
  total: number;
}

export function CycleStressAccounting({
  result,
  state,
  locale,
}: CycleStressAccountingProps) {
  const { t } = useTranslation();
  const drive = result.driveAccounting;
  const charging = result.chargingAccounting;
  const unavailableSources = [
    ...state.failedSources,
    ...state.loadingSources,
  ];
  const driveUnavailable = unavailableSources.includes('drive');
  const chargingUnavailable = unavailableSources.includes('charging');
  const returned = drive.returnedRows + charging.returnedRows;
  const included = drive.includedRows + charging.includedRows;
  const excluded = drive.excludedRows + charging.excludedRows;
  const rows = useMemo<AccountingRow[]>(() => {
    const row = (
      key: string,
      label: string,
      driveCount: number,
      chargingCount: number,
    ): AccountingRow => ({
      key,
      label,
      drive: driveCount,
      charging: chargingCount,
      total: driveCount + chargingCount,
    });
    return [
      row(
        'included',
        t('cycleStress.accounting.included', 'Included'),
        drive.categories.included,
        charging.categories.included,
      ),
      row(
        'incomplete',
        t(
          'cycleStress.accounting.incomplete',
          'Incomplete / live (no explicit end)',
        ),
        drive.categories.incomplete_live,
        charging.categories.incomplete_live,
      ),
      row(
        'invalidTime',
        t(
          'cycleStress.accounting.invalidTime',
          'Invalid timestamp or order',
        ),
        drive.categories.invalid_timestamp_order,
        charging.categories.invalid_timestamp_order,
      ),
      row(
        'future',
        t('cycleStress.accounting.future', 'Future-dated end'),
        drive.categories.future,
        charging.categories.future,
      ),
      row(
        'missingSoc',
        t('cycleStress.accounting.missingSoc', 'Missing SoC endpoint'),
        drive.categories.missing_soc,
        charging.categories.missing_soc,
      ),
      row(
        'invalidSoc',
        t(
          'cycleStress.accounting.invalidSoc',
          'Invalid SoC endpoint',
        ),
        drive.categories.invalid_soc,
        charging.categories.invalid_soc,
      ),
      row(
        'direction',
        t(
          'cycleStress.accounting.direction',
          'Nonpositive or tiny directional change',
        ),
        drive.categories.nonpositive_soc_drop,
        charging.categories.nonpositive_soc_gain,
      ),
      row(
        'overlap',
        t(
          'cycleStress.accounting.overlap',
          'Overlapping interval',
        ),
        drive.categories.overlapping_interval,
        charging.categories.overlapping_interval,
      ),
    ];
  }, [charging.categories, drive.categories, t]);
  const columns = useMemo<Column<AccountingRow>[]>(
    () => [
      {
        key: 'category',
        header: t('cycleStress.accounting.category', 'Primary category'),
        visibleOnMobile: true,
        render: (row) => <Text variant="bodySm">{row.label}</Text>,
      },
      {
        key: 'drive',
        header: t('cycleStress.accounting.drives', 'Drives'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {driveUnavailable
              ? '—'
              : cycleStressNumber(row.drive, locale, 0)}
          </Text>
        ),
      },
      {
        key: 'charging',
        header: t('cycleStress.accounting.charging', 'Charging'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {chargingUnavailable
              ? '—'
              : cycleStressNumber(row.charging, locale, 0)}
          </Text>
        ),
      },
      {
        key: 'total',
        header: t('cycleStress.accounting.total', 'Total'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {cycleStressNumber(row.total, locale, 0)}
          </Text>
        ),
      },
    ],
    [chargingUnavailable, driveUnavailable, locale, t],
  );

  return (
    <section data-testid="cycle-stress-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Database
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'cycleStress.accounting.title',
            'Source-row accounting',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cycleStress.accounting.subtitle',
            'Every returned drive and charging row enters exactly one primary category before any SoC sequence is reconstructed.',
          )}
        </Text>
        <CycleStressSectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={t(
                'cycleStress.accounting.returned',
                'Known rows returned',
              )}
              value={cycleStressNumber(returned, locale, 0)}
              subtitle={t(
                'cycleStress.accounting.sourceSplit',
                'available data: {{drives}} drives + {{charging}} charging',
                {
                  drives: drive.returnedRows,
                  charging: charging.returnedRows,
                },
              )}
              icon={<Database className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'cycleStress.accounting.accepted',
                'Accepted intervals',
              )}
              value={cycleStressNumber(included, locale, 0)}
              subtitle={t(
                'cycleStress.accounting.afterValidation',
                'after validation and overlap rejection',
              )}
              icon={<CircleCheck className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'cycleStress.accounting.excluded',
                'Excluded rows',
              )}
              value={cycleStressNumber(excluded, locale, 0)}
              subtitle={t(
                'cycleStress.accounting.primaryReasons',
                'classified by one primary reason',
              )}
              icon={<CircleSlash2 className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'cycleStress.accounting.sourceTypes',
                'Source types represented',
              )}
              value={cycleStressNumber(
                (drive.includedRows > 0 ? 1 : 0)
                  + (charging.includedRows > 0 ? 1 : 0),
                locale,
                0,
              )}
              subtitle={t(
                'cycleStress.accounting.driveCharge',
                'drive and charging histories',
              )}
              icon={
                included > 0
                  ? <Car className="h-5 w-5" />
                  : <BatteryCharging className="h-5 w-5" />
              }
              color="blue"
            />
          </div>
          <DataTable
            tableId="battery:cycle-stress-accounting"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['category', 'drive', 'charging']}
            emptyMessage={t(
              'cycleStress.accounting.empty',
              'No accounting categories are available.',
            )}
          />
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'cycleStress.accounting.invariant',
                '{{returned}} known returned = {{included}} included + {{excluded}} excluded. Missing completion times are never synthesized from duration, and missing SoC is never imputed.',
                { returned, included, excluded },
              )}
            </Text>
          </AlertBanner>
        </CycleStressSectionBody>
      </GlassPanel>
    </section>
  );
}
