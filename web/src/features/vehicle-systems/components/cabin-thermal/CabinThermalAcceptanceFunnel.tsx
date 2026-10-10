import { LayoutCard } from '@/components/layout';
import { useTranslation } from 'react-i18next';

import {
  Bar,
  BarChart,
  CartesianGrid,
  EmbeddedChart,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { Text } from '@/components/ui';
import { chartTokens } from '@/lib/tokens';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { cabinFunnelLabel } from './labels';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalAcceptanceFunnelProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
}

export function CabinThermalAcceptanceFunnel({
  summary,
  state,
}: CabinThermalAcceptanceFunnelProps) {
  const { t } = useTranslation();
  const data = summary.acceptanceFunnel.map((point) => ({
    stage: cabinFunnelLabel(t, point.stage),
    remaining: point.count,
  }));

  return (
    <section data-testid="cabin-thermal-funnel">
      <LayoutCard title={t('cabinThermal.funnel.title', 'Acceptance funnel')}>
        <Text as="p" variant="caption" className="mb-3">
          {t(
            'cabinThermal.funnel.subtitle',
            'Candidates remaining after each ordered gate; a drop is assigned only at the first failed gate.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="candidates">
          {/* chart-legend-audit:skip one remaining-candidate series across gates */}
          <EmbeddedChart toolbar exportable size="standard"
            className="border-0 bg-transparent p-0 shadow-none"
            title={t('cabinThermal.funnel.plotTitle', 'Windows remaining by gate')}
            ariaLabel={t(
              'cabinThermal.funnel.aria',
              'Horizontal bar chart of candidate windows remaining after each acceptance gate',
            )}
            height={250}
            data={data}
            dataColumns={[
              { key: 'stage', label: t('cabinThermal.funnel.stage', 'Gate stage') },
              { key: 'remaining', label: t('cabinThermal.funnel.remaining', 'Remaining candidates') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ left: 18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis type="category" dataKey="stage" width={150} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="remaining" name={t('cabinThermal.funnel.remaining', 'Remaining candidates')} fill={chartTokens.series[1]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        </CabinThermalSectionBody>
      </LayoutCard>
    </section>
  );
}
