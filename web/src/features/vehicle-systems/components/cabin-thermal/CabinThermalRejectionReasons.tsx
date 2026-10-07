import { ListX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { chartTokens } from '@/lib/tokens';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { cabinRejectionLabel } from './labels';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalRejectionReasonsProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
}

export function CabinThermalRejectionReasons({
  summary,
  state,
}: CabinThermalRejectionReasonsProps) {
  const { t } = useTranslation();
  const data = summary.rejectionReasonCounts.map((item) => ({
    reason: cabinRejectionLabel(t, item.reason),
    candidates: item.count,
  }));

  return (
    <section data-testid="cabin-thermal-rejections">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListX className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.rejections.title', 'Final rejection reasons')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t(
            'cabinThermal.rejections.subtitle',
            'Mutually exclusive first-failure accounting; the bars sum exactly to rejected candidates.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="candidates">
          {/* chart-legend-audit:skip one candidate-count series across gate reasons */}
          <ChartContainer
            className="border-0 bg-transparent p-0 shadow-none"
            title={t('cabinThermal.rejections.plotTitle', 'Candidates rejected at each gate')}
            ariaLabel={t(
              'cabinThermal.rejections.aria',
              'Horizontal bar chart of candidate windows by final rejection reason',
            )}
            height={230}
            data={data}
            dataColumns={[
              { key: 'reason', label: t('cabinThermal.rejections.reason', 'Reason') },
              { key: 'candidates', label: t('cabinThermal.rejections.candidates', 'Candidates') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="reason" width={150} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="candidates" name={t('cabinThermal.rejections.candidates', 'Candidates')} fill={chartTokens.series[3]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}
