import { useMemo, type ComponentProps } from 'react';
import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { AlertBanner } from '@/components/feedback';
import {
  DataTable, GlassPanel, PanelTitle, Text, type Column,
} from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { CycleStressResult } from '../../lib/cycleStress';
import { cycleStressNumber } from '../cycle-stress/labels';
import { CycleStressSectionBody } from '../cycle-stress/CycleStressSectionBody';
import type { CycleStressQueryState } from '../cycle-stress/types';

interface Props {
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
type MobilePresentation = NonNullable<ComponentProps<typeof DataTable<AccountingRow>>['mobilePresentation']>;

export function CycleStressAccounting({ result, state, locale }: Props) {
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
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
        t('cycleStress.accounting.incomplete', 'Incomplete / live (no explicit end)'),
        drive.categories.incomplete_live,
        charging.categories.incomplete_live,
      ),
      row(
        'invalidTime',
        t('cycleStress.accounting.invalidTime', 'Invalid timestamp or order'),
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
        t('cycleStress.accounting.invalidSoc', 'Invalid SoC endpoint'),
        drive.categories.invalid_soc,
        charging.categories.invalid_soc,
      ),
      row(
        'direction',
        t('cycleStress.accounting.direction', 'Nonpositive or tiny directional change'),
        drive.categories.nonpositive_soc_drop,
        charging.categories.nonpositive_soc_gain,
      ),
      row(
        'overlap',
        t('cycleStress.accounting.overlap', 'Overlapping interval'),
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
            {driveUnavailable ? '—' : cycleStressNumber(row.drive, locale)}
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
            {chargingUnavailable ? '—' : cycleStressNumber(row.charging, locale)}
          </Text>
        ),
      },
      {
        key: 'total',
        header: t('cycleStress.accounting.total', 'Total'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {cycleStressNumber(row.total, locale)}
          </Text>
        ),
      },
    ],
    [chargingUnavailable, driveUnavailable, locale, t, displayPrecision, displayLocale],
  );
  const mobilePresentation = useMemo<MobilePresentation>(() => ({
    variant: 'keyValue',
    roles: { category: 'title', total: 'primary', drive: 'meta', charging: 'meta' },
    displayValue: (row, key) => {
      if (key === 'category') return row.label;
      if (key === 'drive') return driveUnavailable ? '—' : cycleStressNumber(row.drive, locale);
      if (key === 'charging') return chargingUnavailable ? '—' : cycleStressNumber(row.charging, locale);
      if (key === 'total') return cycleStressNumber(row.total, locale);
      return null;
    },
  }), [chargingUnavailable, driveUnavailable, locale, displayPrecision, displayLocale]);

  return (
    <section aria-label={t('cycleStress.accounting.title', 'Source-row accounting')} data-testid="cycle-stress-accounting">
      <GlassPanel className="min-w-0 p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('cycleStress.accounting.title', 'Source-row accounting')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('cycleStress.accounting.subtitle',
            'Every returned drive and charging row enters exactly one primary category before any SoC sequence is reconstructed.')}
        </Text>
        <CycleStressSectionBody result={result} state={state} requirement="none">
          <BatteryEvidenceBrief
            title={t('cycleStress.modernization.accountingSummary', 'Drive and charging row summary')}
            retained={Boolean(state.refreshError)}
            period={{ kind: 'unknown', label: t('cycleStress.modernization.period', 'Returned vehicle histories · bounded evidence'),
              reason: t('cycleStress.modernization.provenance', 'Reconstructed from up to 1,000 drives and 1,000 charging sessions. Source spans may differ; this is not a selected-date-window or full-history total.') }}
            metrics={[
              { metricId: 'count', occurrenceId: 'rows-returned', rawValue: returned,
                label: t('cycleStress.accounting.returned', 'Known rows returned'),
                display: { formatter: raw => ({ value: cycleStressNumber(raw, locale), unit: '' }) },
                context: t('cycleStress.accounting.sourceSplit', 'available data: {{drives}} drives + {{charging}} charging',
                  { drives: drive.returnedRows, charging: charging.returnedRows }) },
              { metricId: 'count', occurrenceId: 'accepted-intervals', rawValue: included,
                label: t('cycleStress.accounting.accepted', 'Accepted intervals'),
                display: { formatter: raw => ({ value: cycleStressNumber(raw, locale), unit: '' }) },
                context: t('cycleStress.accounting.afterValidation', 'after validation and overlap rejection') },
              { metricId: 'count', occurrenceId: 'excluded-rows', rawValue: excluded,
                label: t('cycleStress.accounting.excluded', 'Excluded rows'),
                display: { formatter: raw => ({ value: cycleStressNumber(raw, locale), unit: '' }) },
                context: t('cycleStress.accounting.primaryReasons', 'classified by one primary reason') },
              { metricId: 'count', occurrenceId: 'source-types', rawValue: (drive.includedRows > 0 ? 1 : 0) + (charging.includedRows > 0 ? 1 : 0),
                label: t('cycleStress.accounting.sourceTypes', 'Source types represented'),
                display: { formatter: raw => ({ value: cycleStressNumber(raw, locale), unit: '' }) },
                context: t('cycleStress.accounting.driveCharge', 'drive and charging histories') },
            ]}
          />
          <DataTable variant="embedded"
            tableId="battery:cycle-stress-accounting"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['category', 'drive', 'charging']}
            mobilePresentation={mobilePresentation}
            emptyMessage={t('cycleStress.accounting.empty', 'No accounting categories are available.')}
          />
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t('cycleStress.accounting.invariant',
                '{{returned}} known returned = {{included}} included + {{excluded}} excluded. Missing completion times are never synthesized from duration, and missing SoC is never imputed.',
                { returned, included, excluded })}
            </Text>
          </AlertBanner>
        </CycleStressSectionBody>
      </GlassPanel>
    </section>
  );
}
