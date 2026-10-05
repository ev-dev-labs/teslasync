import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, ChartTooltip } from '@/components/charts';
import { ChartCard } from '@/components/layout/layout-reference';
import { Text, Caption } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import type { YearReview } from '@/api/types';

interface Props {
  data?: YearReview;
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
  emptyMessage: string;
}

export function YearChargingMix({ data, loading, error, onRetry, emptyMessage }: Props) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  // Connector identity owns the colour, not the post-filter index.
  const slices = useMemo(() => [
    { name: t('yearReview.supercharger', 'Supercharger'), value: data?.supercharger_pct ?? 0, color: '#f59e0b' },
    { name: t('yearReview.dcFast', 'DC fast'), value: data?.dc_fast_pct ?? 0, color: '#6366f1' },
    { name: t('yearReview.acOther', 'AC / other'), value: data?.ac_other_pct ?? 0, color: '#94a3b8' },
  ].filter(s => s.value > 0), [data?.supercharger_pct, data?.dc_fast_pct, data?.ac_other_pct, t]);

  return (
    <ChartCard
      title={t('yearReview.chargingBreakdown', 'Charging mix')}
      subtitle={data ? t('yearReview.chargingSummary', {
        sessions: fmtInt(data.total_charge_sessions ?? 0),
        soc: Math.round(data.avg_charge_start_soc ?? 0),
        defaultValue: '{{sessions}} sessions · avg plug-in at {{soc}}%',
      }) : undefined}
      ariaLabel={t('yearReview.chargingBreakdownAria', 'Donut chart of charging mix by connector type')}
      loading={loading}
      error={error}
      onRetry={onRetry}
      empty={slices.length === 0}
      emptyMessage={emptyMessage}
      data={slices.map(s => ({ type: s.name, share: Math.round(s.value) }))}
      dataColumns={[
        { key: 'type', label: t('yearReview.connector', 'Connector') },
        { key: 'share', label: t('yearReview.share', 'Share (%)') },
      ]}
      footer={!loading && slices.length > 0 ? (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-2">
          {slices.map(s => (
            <li key={s.name} className="flex flex-wrap items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <Text variant="bodySm">{s.name}</Text>
              <Caption>{Math.round(s.value)}%</Caption>
            </li>
          ))}
        </ul>
      ) : undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={slices} cx="50%" cy="50%" innerRadius={52} outerRadius={82} paddingAngle={3} dataKey="value"
            strokeWidth={0} isAnimationActive={!reduce}>
            {slices.map(s => <Cell key={s.name} fill={s.color} />)}
          </Pie>
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
