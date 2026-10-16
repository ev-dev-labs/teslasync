import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';

import { Badge, Button, Icon, Text, Caption } from '@/components/ui';
import { LayoutCard, SourceContent } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';
import { Skeleton } from '@/components/feedback';

import { useEfficiencyShift } from '@/api/hooks/useAnalytics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { typography } from '@/lib/tokens';
import { MapsOperationalBrief } from './operationalbrief-all/MapsOperationalBrief';

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
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const query = useEfficiencyShift(vehicleId);
  const { data, isLoading, refetch } = query;
  const state = deriveDataState({ ...query, data: data ?? undefined });
  const noVehicle = !vehicleId;
  const unresolved = !noVehicle && !state.hasData && !query.isSuccess;
  const initialBlocked = unresolved && state.isRefreshBlocked;
  const emptyMessage = noVehicle
    ? t('tempImpact.detective.noData', 'Select a vehicle to diagnose efficiency shifts.')
    : initialBlocked
      ? t('system.outage.pausedSource', 'Waiting for a connection before this source can load. Missing evidence remains unknown.')
      : unresolved
        ? t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')
        : t('efficiency.noStats', 'No efficiency data available yet');
  const scope = t('tempImpact.detective.brief.scope', 'Selected vehicle · {{latest}} versus {{prior}} · independent server diagnosis.', {
    latest: data?.latest_month ?? '—', prior: data?.prior_month ?? '—',
  });
  const detail = t(
    'tempImpact.detective.detail',
    '{{delta}}% vs prior month · {{attributed}}% temperature-attributed · {{temp}}°C shift',
    {
      delta: data?.efficiency_delta_pct == null ? '—' : fmtNumber(data.efficiency_delta_pct),
      attributed: data?.temp_attributed_pct == null ? '—' : fmtNumber(data.temp_attributed_pct),
      temp: data?.temp_delta_c == null ? '—' : fmtNumber(data.temp_delta_c),
    },
  );
  const metrics = [
    { metricId: 'percent', occurrenceId: 'detective-delta', rawValue: data?.efficiency_delta_pct, label: t('tempImpact.detective.brief.delta', 'Efficiency change'), description: scope, display: { formatter: (raw: number) => ({ value: `${fmtNumber(raw)}%`, unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'detective-attributed', rawValue: data?.temp_attributed_pct, label: t('tempImpact.detective.brief.attributed', 'Temperature attribution'), description: scope, display: { formatter: (raw: number) => ({ value: `${fmtNumber(raw)}%`, unit: '' }) } },
    { metricId: 'number', occurrenceId: 'detective-temperature', rawValue: data?.temp_delta_c, label: t('tempImpact.detective.brief.temperature', 'Temperature shift'), description: t('tempImpact.detective.brief.temperatureDescription', 'Temperature difference in source degrees Celsius, not an absolute temperature conversion.'), display: { formatter: (raw: number) => ({ value: `${fmtNumber(raw)}°C`, unit: '' }) } },
  ] as const;

  return (
    <LayoutCard
      title={t('tempImpact.detective.title', 'Efficiency detective')}
      actions={<><Icon icon={Lightbulb} className={typography.color.muted} aria-hidden={true} />{data && (
          <Badge variant={verdictBadge(data.verdict, t).variant} size="sm">
            {verdictBadge(data.verdict, t).label}
          </Badge>
        )}</>}
    >
      <SourceContent
        state={state.fatalError ? 'error' : state.status === 'stale' ? 'retained' : !noVehicle && !initialBlocked && isLoading && !state.hasData ? 'loading' : !data ? 'empty' : 'ready'}
        label={t('tempImpact.detective.title', 'Efficiency detective')}
        error={state.fatalError}
        errorRecovery={{ onRetry: () => void refetch() }}
        errorMessage={t('tempImpact.detective.loadFailed', 'Efficiency diagnosis could not be loaded.')}
        emptyMessage={emptyMessage}
        emptyContent={
          <div className="min-w-0 space-y-2 break-words">
            <Caption role={unresolved ? 'status' : undefined} aria-live={unresolved ? 'polite' : undefined}>{emptyMessage}</Caption>
            {!noVehicle && (
              <Button type="button" variant="secondary" size="sm" wrapLabel
                className="max-w-full min-h-11 md:min-h-9" onClick={() => void refetch()}>
                {t('error.retry', 'Retry')}
              </Button>
            )}
          </div>
        }
        loadingContent={<Skeleton height={96} />}
      >
      {data && (
        <div className="space-y-2">
          <Text as="p" variant="bodySm">{data.explanation}</Text>
          {data.verdict !== 'insufficient_data' && (
            <>
              <MapsOperationalBrief variant="embedded"
                title={t('tempImpact.detective.brief.title', 'Month-over-month diagnosis')}
                description={detail}
                scope={scope}
                metrics={metrics}
                sources={[{ label: t('tempImpact.detective.title', 'Efficiency detective'), state }]}
              />
            </>
          )}
        </div>
      )}
      </SourceContent>
    </LayoutCard>
  );
}
