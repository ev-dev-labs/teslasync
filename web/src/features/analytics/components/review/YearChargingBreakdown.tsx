import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartContainer } from '@/components/charts';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, ChartTooltip } from '@/components/charts';
import { Text, Caption } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
}

/** How the year's charging split across Supercharger / DC fast / AC. */
export function YearChargingBreakdown({ data }: Props) {
  const { t } = useTranslation();

  // Colour travels with each slice (keyed to the connector, not to the
  // post-filter index) so a zero-share connector being dropped never shifts
  // the remaining connectors onto a different colour.
  const slices = useMemo(
    () =>
      [
        { name: t('yearReview.supercharger', 'Supercharger'), value: data.supercharger_pct ?? 0, color: '#f59e0b' },
        { name: t('yearReview.dcFast', 'DC Fast'), value: data.dc_fast_pct ?? 0, color: '#6366f1' },
        { name: t('yearReview.acOther', 'AC / Other'), value: data.ac_other_pct ?? 0, color: '#94a3b8' },
      ].filter((s) => s.value > 0),
    [data.supercharger_pct, data.dc_fast_pct, data.ac_other_pct, t],
  );

  return (
    <ChartContainer
      title={t('yearReview.chargingBreakdown', 'Charging mix')}
      subtitle={t('yearReview.chargingSummary', {
        sessions: fmtInt(data.total_charge_sessions ?? 0),
        soc: Math.round(data.avg_charge_start_soc ?? 0),
        defaultValue: '{{sessions}} sessions · avg plug-in at {{soc}}%',
      })}
      ariaLabel={t('yearReview.chargingBreakdownAria', 'Donut chart of charging mix by connector type')}
      empty={slices.length === 0}
      exportable={false}
      data={slices.map((s) => ({ type: s.name, share: Math.round(s.value) }))}
      dataColumns={[
        { key: 'type', label: t('yearReview.connector', 'Connector') },
        { key: 'share', label: t('yearReview.share', 'Share (%)') },
      ]}
    >
      <div className="h-56 sm:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={3} dataKey="value" strokeWidth={0}>
              {slices.map((s) => (
                <Cell key={s.name} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {slices.map((s) => (
          <li key={s.name} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
              aria-hidden="true"
            />
            <Text variant="bodySm">{s.name}</Text>
            <Caption>{Math.round(s.value)}%</Caption>
          </li>
        ))}
      </ul>
    </ChartContainer>
  );
}
