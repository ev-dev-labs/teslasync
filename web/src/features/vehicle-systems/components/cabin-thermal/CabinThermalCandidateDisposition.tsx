import { GitCompareArrows } from 'lucide-react';
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
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalCandidateDispositionProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
}

export function CabinThermalCandidateDisposition({
  summary,
  state,
}: CabinThermalCandidateDispositionProps) {
  const { t } = useTranslation();
  const data = [
    {
      disposition: t('cabinThermal.disposition.accepted', 'Accepted fits'),
      windows: summary.accounting.acceptedFits,
    },
    {
      disposition: t('cabinThermal.disposition.rejected', 'Rejected candidates'),
      windows: summary.accounting.rejectedCandidates,
    },
  ];

  return (
    <section data-testid="cabin-thermal-disposition">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.disposition.title', 'Candidate disposition')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t(
            'cabinThermal.disposition.subtitle',
            'Candidate windows are counted once as accepted or rejected; neither count is a row count.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="candidates">
          {/* chart-legend-audit:skip one count series across disposition categories */}
          <ChartContainer
            className="border-0 bg-transparent p-0 shadow-none"
            title={t('cabinThermal.disposition.plotTitle', 'Accepted versus rejected')}
            ariaLabel={t(
              'cabinThermal.disposition.aria',
              'Bar chart comparing accepted fits with rejected candidate windows',
            )}
            height={190}
            data={data}
            dataColumns={[
              { key: 'disposition', label: t('cabinThermal.disposition.category', 'Disposition') },
              { key: 'windows', label: t('cabinThermal.disposition.windows', 'Windows') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="disposition" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="windows" name={t('cabinThermal.disposition.windows', 'Windows')} fill={chartTokens.series[0]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}
