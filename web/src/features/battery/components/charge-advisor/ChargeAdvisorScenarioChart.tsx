import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from '@/components/charts';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { ChartContainer, ChartTooltip } from '@/components/charts';
import { Text } from '@/components/ui';
import { chartTokens } from '@/lib/tokens';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorScenarioChart({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const rows = analysis.scenarios.meanPath.map((day) => ({
    date: day.localDate,
    mean: day.meanEndSocPct,
    p75: day.p75EndSocPct,
    meanBurn: day.meanBurnPct,
    p75Burn: day.p75BurnPct,
  }));

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.scenarios.title', 'Seven-day use scenarios')}
      subtitle={t(
        'chargeAdvisor.scenarios.subtitle',
        'Seven complete local days beginning tomorrow; mean and calendar-day p75 paths are descriptive scenarios.',
      )}
      icon={<Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="drive"
      dataTestId="charge-advisor-scenarios"
    >
      {rows.length === 0 ? (
        <Text as="p" variant="bodySm" className="py-12 text-center">
          {t(
            'chargeAdvisor.scenarios.empty',
            'A scenario needs at least one qualified drive-associated SoC-drop day and a valid current state.',
          )}
        </Text>
      ) : (
        <ChartContainer
          title={t('chargeAdvisor.scenarios.chartTitle', 'Scenario SoC paths')}
          ariaLabel={t(
            'chargeAdvisor.scenarios.aria',
            'Mean and calendar-day p75 battery percentage paths for seven complete local days starting tomorrow',
          )}
          data={rows}
          dataColumns={[
            { key: 'date', label: t('chargeAdvisor.chart.date', 'Local date') },
            { key: 'mean', label: t('chargeAdvisor.chart.meanSoc', 'Mean path SoC') },
            { key: 'p75', label: t('chargeAdvisor.chart.p75Soc', 'Calendar-day p75 path SoC') },
            { key: 'meanBurn', label: t('chargeAdvisor.chart.meanBurn', 'Mean use') },
            { key: 'p75Burn', label: t('chargeAdvisor.chart.p75Burn', 'Calendar-day p75 use') },
          ]}
          chartKey="charge-advisor-scenarios"
          height={290}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows}>
              <CartesianGrid stroke={chartTokens.gridStroke} strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis domain={[0, 100]} />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="mean"
                name={t('chargeAdvisor.scenarios.meanPath', 'Mean path')}
                stroke={chartTokens.series[0]}
                fill={chartTokens.series[0]}
                fillOpacity={0.12}
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="p75"
                name={t('chargeAdvisor.scenarios.p75Path', 'Calendar-day p75 path')}
                stroke={chartTokens.series[4]}
                fill={chartTokens.series[4]}
                fillOpacity={0.08}
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      )}
    </ChargeAdvisorSection>
  );
}
