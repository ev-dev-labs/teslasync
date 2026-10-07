import { BadgeCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { chartTokens } from '@/lib/tokens';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalFitQualityProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  formatDuration: UnitFormatter;
}

export function CabinThermalFitQuality({
  summary,
  state,
  formatDuration,
}: CabinThermalFitQualityProps) {
  const { t } = useTranslation();
  const points = summary.events.map((event, index) => ({
    event: index + 1,
    quality: Math.round(event.r2 * 1_000) / 10,
    tau: formatDuration(event.tauMin * 60, { precision: 1 }),
    direction: event.cooling
      ? t('cabinThermal.direction.cooling', 'Cooling')
      : t('cabinThermal.direction.warming', 'Warming'),
    regime: event.cooling ? 'cooling' : 'warming',
  }));
  const cooling = points.filter((point) => point.regime === 'cooling');
  const warming = points.filter((point) => point.regime === 'warming');

  return (
    <section data-testid="cabin-thermal-fit-quality">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BadgeCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.fit.title', 'Accepted-fit quality')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-3">
          {t(
            'cabinThermal.fit.subtitle',
            'R² belongs only to accepted log-linear fits; rejected candidates remain in the diagnostic directory.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="accepted">
          <ChartContainer
            className="border-0 bg-transparent p-0 shadow-none"
            title={t('cabinThermal.fit.plotTitle', 'R² by accepted event')}
            ariaLabel={t(
              'cabinThermal.fit.aria',
              'Scatter chart of R squared fit quality for accepted cooling and warming events',
            )}
            height={220}
            data={points}
            dataColumns={[
              { key: 'event', label: t('cabinThermal.fit.event', 'Accepted event') },
              { key: 'quality', label: t('cabinThermal.fit.r2Percent', 'R² (%)') },
              { key: 'tau', label: t('cabinThermal.fit.tau', 'τ') },
              { key: 'direction', label: t('cabinThermal.fit.direction', 'Direction') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis type="number" dataKey="event" allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis type="number" dataKey="quality" domain={[0, 100]} unit="%" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Scatter name={t('cabinThermal.direction.cooling', 'Cooling')} data={cooling} fill={chartTokens.series[0]} />
                <Scatter name={t('cabinThermal.direction.warming', 'Warming')} data={warming} fill={chartTokens.series[3]} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}
