import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';

import { GlassPanel, Badge, PanelTitle, Text, Caption } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';
import { useEfficiencyShift } from '@/api/hooks/useAnalytics';

interface EfficiencyDetectivePanelProps {
  vehicleId: string;
}

function verdictBadge(verdict: string, t: (k: string, d: string) => string): { label: string; variant: 'success' | 'info' | 'warning' | 'neutral' } {
  switch (verdict) {
    case 'stable':
      return { label: t('tempImpact.detective.stable', 'Stable'), variant: 'success' };
    case 'colder_weather':
      return { label: t('tempImpact.detective.colder', 'Colder weather'), variant: 'info' };
    case 'warmer_driving':
      return { label: t('tempImpact.detective.warmer', 'Warmer weather'), variant: 'info' };
    case 'driving_pattern':
      return { label: t('tempImpact.detective.pattern', 'Driving pattern'), variant: 'warning' };
    default:
      return { label: t('tempImpact.detective.insufficient', 'Need more data'), variant: 'neutral' };
  }
}

/**
 * Efficiency detective: latest vs prior month diagnosis with temperature
 * attribution. Mounted on TemperatureImpactPage below the KPI band.
 */
export function EfficiencyDetectivePanel({ vehicleId }: EfficiencyDetectivePanelProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError, error, refetch } = useEfficiencyShift(vehicleId);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('tempImpact.detective.title', 'Efficiency Detective')}
        </PanelTitle>
        {data && (
          <Badge variant={verdictBadge(data.verdict, t).variant} size="sm">
            {verdictBadge(data.verdict, t).label}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <Skeleton height={96} />
      ) : isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <Caption>{t('tempImpact.detective.noData', 'Select a vehicle to diagnose efficiency shifts.')}</Caption>
      ) : (
        <div className="space-y-2">
          <Text as="p" variant="bodySm">{data.explanation}</Text>
          {data.verdict !== 'insufficient_data' && (
            <Text as="p" variant="caption" className="tabular-nums">
              {t(
                'tempImpact.detective.detail',
                '{{delta}}% vs prior month · {{attributed}}% temperature-attributed · {{temp}}°C shift',
                {
                  delta: fmtNumber(data.efficiency_delta_pct, 1),
                  attributed: fmtNumber(data.temp_attributed_pct, 1),
                  temp: fmtNumber(data.temp_delta_c, 1),
                },
              )}
            </Text>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
