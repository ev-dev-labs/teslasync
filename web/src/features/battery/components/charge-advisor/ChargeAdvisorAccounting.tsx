import { ClipboardList, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorAccounting({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const driveCategories = Object.entries(analysis.driveAccounting.categories);
  const chargingCategories = Object.entries(analysis.chargingAccounting.categories);
  const categoryLabel = (category: string) => {
    const fallback: Record<string, string> = {
      included: 'included',
      outside_window: 'outside window',
      incomplete_live: 'incomplete or live',
      invalid_timestamp_order: 'invalid timestamp or order',
      future: 'future',
      invalid_duration: 'invalid duration',
      missing_soc: 'missing SoC',
      invalid_soc: 'invalid SoC',
      nonpositive_soc_drop: 'nonpositive SoC drop',
      nonpositive_soc_gain: 'nonpositive SoC gain',
      implausible_soc_drop: 'implausible SoC drop',
    };
    return t(
      `chargeAdvisor.accounting.category.${category}`,
      fallback[category] ?? 'unclassified',
    );
  };
  const driveSummary = [
    {
      label: t('chargeAdvisor.accounting.returnedRows', 'Returned rows'),
      value: analysis.driveAccounting.returnedRows,
    },
    {
      label: t('chargeAdvisor.accounting.inWindowRows', 'In-window rows'),
      value: analysis.driveAccounting.inWindowRows,
    },
    {
      label: t('chargeAdvisor.accounting.includedRows', 'Included rows'),
      value: analysis.driveAccounting.includedRows,
    },
  ];
  const chargingSummary = [
    {
      label: t('chargeAdvisor.accounting.returnedRows', 'Returned rows'),
      value: analysis.chargingAccounting.returnedRows,
    },
    {
      label: t('chargeAdvisor.accounting.inWindowRows', 'In-window rows'),
      value: analysis.chargingAccounting.inWindowRows,
    },
    {
      label: t('chargeAdvisor.accounting.includedRows', 'Included rows'),
      value: analysis.chargingAccounting.includedRows,
    },
  ];

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.accounting.title', 'Evidence accounting')}
      subtitle={t(
        'chargeAdvisor.accounting.subtitle',
        'Every returned row is assigned exactly one mutually exclusive category.',
      )}
      icon={<ClipboardList className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="both"
      dataTestId="charge-advisor-accounting"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <Text className="font-semibold">{t('chargeAdvisor.accounting.drives', 'Drive rows')}</Text>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {driveSummary.map((item) => (
              <div key={item.label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2">
                <Text variant="caption">{item.label}</Text>
                <Text className="mt-1 font-semibold">{fmtInt(item.value)}</Text>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {driveCategories.map(([category, count]) => (
              <div key={category} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2">
                <Text variant="caption">{categoryLabel(category)}</Text>
                <Badge variant={category === 'included' ? 'success' : 'neutral'}>{fmtInt(count)}</Badge>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Database className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            <Text className="font-semibold">{t('chargeAdvisor.accounting.charging', 'Charging rows')}</Text>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {chargingSummary.map((item) => (
              <div key={item.label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2">
                <Text variant="caption">{item.label}</Text>
                <Text className="mt-1 font-semibold">{fmtInt(item.value)}</Text>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {chargingCategories.map(([category, count]) => (
              <div key={category} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-2)] px-3 py-2">
                <Text variant="caption">{categoryLabel(category)}</Text>
                <Badge variant={category === 'included' ? 'success' : 'neutral'}>{fmtInt(count)}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Text as="p" variant="caption" className="mt-4">
        {t(
          'chargeAdvisor.accounting.window',
          'Included history window: {{start}} through {{end}} in {{timeZone}}.',
          {
            start: analysis.evidence.windowStartLocalDate,
            end: analysis.evidence.windowEndLocalDate,
            timeZone: analysis.timeZone,
          },
        )}
      </Text>
    </ChargeAdvisorSection>
  );
}
