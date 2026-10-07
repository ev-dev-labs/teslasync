import { ClipboardList, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { type StatMetric } from '@/components/data-display';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function ChargeAdvisorAccounting({ analysis, state }: ChargeAdvisorComponentProps) {
  const { fmtInt } = useNumberFormatting();
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
  const summaryMetrics = (items: typeof driveSummary, source: 'drive' | 'charging'): StatMetric[] =>
    items.map((item, index) => ({
      metricId: 'count',
      occurrenceId: `advisor-${source}-accounting-${index}`,
      label: item.label,
      rawValue: item.value,
      display: { formatter: raw => ({ value: fmtInt(raw), unit: '' }) },
    }));
  const period = {
    kind: 'unknown' as const,
    label: t('chargeAdvisor.accounting.summaryWindow', 'Analysis window: {{start}} – {{end}} ({{timeZone}})', {
      start: analysis.evidence.windowStartLocalDate,
      end: analysis.evidence.windowEndLocalDate,
      timeZone: analysis.timeZone,
    }),
    reason: t('chargeAdvisor.accounting.scope', 'Returned histories; qualification uses the stated local-date analysis window. Counts are not lifetime totals.'),
  };

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
          <BatteryEvidenceBrief
            title={t('chargeAdvisor.accounting.driveSummary', 'Drive-row evidence summary')}
            metrics={summaryMetrics(driveSummary, 'drive')}
            period={period}
            retained={Boolean(state.refreshError)}
          />
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
          <BatteryEvidenceBrief
            title={t('chargeAdvisor.accounting.chargingSummary', 'Charging-row evidence summary')}
            metrics={summaryMetrics(chargingSummary, 'charging')}
            period={period}
            retained={Boolean(state.refreshError)}
          />
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
