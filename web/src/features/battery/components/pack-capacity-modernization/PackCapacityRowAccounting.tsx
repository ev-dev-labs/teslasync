import { useMemo } from 'react';
import { Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { type StatMetric } from '@/components/data-display/stat-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { AlertBanner } from '@/components/feedback';
import { DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import type { PackCapacityResult, PackCapacityRowCategory } from '../../lib/packCapacity';
import type { PackCapacityQueryState } from '../pack-capacity';
import { packCapacityNumber, packCapacityPercent } from '../pack-capacity/labels';
import { PackCapacitySectionBody } from '../pack-capacity/PackCapacitySectionBody';

interface AccountingRow {
  key: PackCapacityRowCategory;
  label: string;
  count: number;
}

/** Exact mutually exclusive accounting, with every category reachable on mobile. */
export function PackCapacityRowAccounting({
  result, state, locale,
}: {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
}) {
  const { t } = useTranslation();
  const accounting = result.accounting;
  const rows = useMemo<AccountingRow[]>(() => [
    { key: 'included', label: t('packCapacity.accounting.included', 'Included'), count: accounting.categories.included },
    {
      key: 'incomplete_live',
      label: t('packCapacity.accounting.incomplete', 'Incomplete / live (no explicit completion)'),
      count: accounting.categories.incomplete_live,
    },
    {
      key: 'invalid_timestamp_order',
      label: t('packCapacity.accounting.invalidTime', 'Invalid timestamp or order'),
      count: accounting.categories.invalid_timestamp_order,
    },
    { key: 'future', label: t('packCapacity.accounting.future', 'Future-dated completion'), count: accounting.categories.future },
    { key: 'missing_soc', label: t('packCapacity.accounting.missingSoc', 'Missing SoC endpoint'), count: accounting.categories.missing_soc },
    { key: 'invalid_soc', label: t('packCapacity.accounting.invalidSoc', 'Invalid SoC endpoint'), count: accounting.categories.invalid_soc },
    {
      key: 'nonpositive_soc_gain',
      label: t('packCapacity.accounting.nonpositiveGain', 'Nonpositive SoC gain'),
      count: accounting.categories.nonpositive_soc_gain,
    },
    { key: 'missing_energy', label: t('packCapacity.accounting.missingEnergy', 'Missing energy'), count: accounting.categories.missing_energy },
    {
      key: 'invalid_energy',
      label: t('packCapacity.accounting.invalidEnergy', 'Invalid or nonpositive energy'),
      count: accounting.categories.invalid_energy,
    },
    {
      key: 'below_soc_window',
      label: t('packCapacity.accounting.belowWindow', 'Below selected SoC window'),
      count: accounting.categories.below_soc_window,
    },
    {
      key: 'implausible_capacity',
      label: t('packCapacity.accounting.implausible', 'Implausible implied capacity'),
      count: accounting.categories.implausible_capacity,
    },
    {
      key: 'duplicate_session',
      label: t('packCapacity.accounting.duplicate', 'Duplicate session identifier'),
      count: accounting.categories.duplicate_session,
    },
    {
      key: 'overlapping_interval',
      label: t('packCapacity.accounting.overlap', 'Overlapping interval'),
      count: accounting.categories.overlapping_interval,
    },
    {
      key: 'outside_analysis_cap',
      label: t('packCapacity.accounting.outsideCap', 'Outside analysis cap'),
      count: accounting.categories.outside_analysis_cap,
    },
  ], [accounting.categories, t]);
  const share = (row: AccountingRow) => packCapacityPercent(
    accounting.returnedRows > 0 ? row.count / accounting.returnedRows : 0, locale,
  );
  const columns = useMemo<Column<AccountingRow>[]>(() => [
    {
      key: 'category',
      header: t('packCapacity.accounting.category', 'Primary category'),
      visibleOnMobile: true,
      render: row => <Text variant="bodySm">{row.label}</Text>,
    },
    {
      key: 'count',
      header: t('packCapacity.accounting.rows', 'Rows'),
      align: 'right',
      visibleOnMobile: true,
      render: row => <Text variant="bodySm" className="font-mono tabular-nums">
        {packCapacityNumber(row.count, locale, 0)}
      </Text>,
    },
    {
      key: 'share',
      header: t('packCapacity.accounting.share', 'Returned share'),
      align: 'right',
      render: row => <Text variant="bodySm" className="font-mono tabular-nums">
        {packCapacityPercent(accounting.returnedRows > 0 ? row.count / accounting.returnedRows : 0, locale)}
      </Text>,
    },
  ], [accounting.returnedRows, locale, t]);
  const exclusionShare = accounting.returnedRows > 0
    ? accounting.excludedRows / accounting.returnedRows : 0;
  const metric = (occurrenceId: string, label: string, value: number, context: string,
    formatter: (raw: number) => string): StatMetric => ({
    metricId: 'number', occurrenceId, rawValue: value, label, description: context, context,
    display: { formatter: raw => ({ value: formatter(raw), unit: '' }) },
  });
  const metrics = [
    metric('pack-capacity:returned', t('packCapacity.accounting.returned', 'Rows returned'),
      accounting.returnedRows,
      t('packCapacity.accounting.requested', 'up to {{limit}} requested', { limit: accounting.historyLimit }), raw => packCapacityNumber(raw, locale, 0)),
    metric('pack-capacity:accepted', t('packCapacity.accounting.accepted', 'Qualified measurements'),
      accounting.includedRows,
      t('packCapacity.accounting.afterValidation', 'after all validation and cap rules'), raw => packCapacityNumber(raw, locale, 0)),
    metric('pack-capacity:excluded', t('packCapacity.accounting.excluded', 'Excluded rows'),
      accounting.excludedRows,
      t('packCapacity.accounting.primaryReason', 'one primary reason per row'), raw => packCapacityNumber(raw, locale, 0)),
    metric('pack-capacity:exclusion-share', t('packCapacity.accounting.exclusionShare', 'Excluded share'),
      exclusionShare,
      t('packCapacity.accounting.ofReturned', 'of known returned rows'), raw => packCapacityPercent(raw, locale)),
  ];

  return (
    <section aria-label={t('packCapacity.accounting.title', 'Source-row accounting')} data-testid="pack-capacity-accounting">
      <GlassPanel className="min-w-0 p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('packCapacity.accounting.title', 'Source-row accounting')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('packCapacity.accounting.subtitle', 'Every returned charging row enters exactly one primary category before filtering.')}
        </Text>
        <PackCapacitySectionBody result={result} state={state} requirement="none">
          <BatteryEvidenceBrief
            id="pack-capacity-accounting-summary"
            title={t('packCapacity.modernization.accountingSummary', 'Charging-row summary')}
            metrics={metrics}
            retained={Boolean(state.refreshError)}
            period={{
              kind: 'alltime',
              label: t('packCapacity.modernization.period', 'Returned charging-history window'),
              provenance: t('packCapacity.accounting.subtitle', 'Every returned charging row enters exactly one primary category before filtering.'),
            }}
          />
          <DataTable
            tableId="battery:pack-capacity-accounting"
            variant="embedded"
            columns={columns}
            data={rows}
            keyExtractor={row => row.key}
            // Keep share reachable in the 640–767px table fallback too.
            mobileColumns={['category', 'count', 'share']}
            mobilePresentation={{
              variant: 'keyValue',
              roles: { category: 'title', count: 'primary', share: 'meta' },
              displayValue: (row, key) => key === 'category' ? row.label
                : key === 'count' ? packCapacityNumber(row.count, locale, 0)
                  : key === 'share' ? share(row) : null,
            }}
            emptyMessage={t('packCapacity.accounting.empty', 'No accounting categories are available.')}
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
