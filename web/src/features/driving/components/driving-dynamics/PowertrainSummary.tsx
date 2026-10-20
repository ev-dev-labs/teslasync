import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import { useMotorStats, MOTOR_HISTORY_LIMIT } from './useMotorStats';

interface PowertrainSummaryProps {
  vehicleId: number | null | undefined;
  historyQuery: MotorHistoryQuery;
}

/** Describes measured evidence without inferring style, health, or pedal inputs. */
export default function PowertrainSummary({ vehicleId, historyQuery }: PowertrainSummaryProps) {
  const { t } = useTranslation();
  const { formatPower, formatTemperature } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const query = useMotorStats(vehicleId, historyQuery);
  const stats = query.motorStats;

  const facts = [
    {
      title: t('dynamics.powertrain.output', 'Power & regeneration'),
      text: t('dynamics.powertrain.outputEvidence', 'Peak sampled power {{power}}; peak sampled regen {{regen}}. These are instantaneous readings, not trip energy totals.', {
        power: formatPower(stats?.peakPower != null ? stats.peakPower * 1000 : null),
        regen: formatPower(stats?.peakRegen != null ? stats.peakRegen * 1000 : null),
      }),
    },
    {
      title: t('dynamics.powertrain.load', 'Motor load & temperature'),
      text: t('dynamics.powertrain.loadEvidence', 'Peak reported axle torque {{torque}}; hottest recorded motor {{temperature}}. A missing axle or temperature signal limits the evidence.', {
        torque: stats?.maxTorque != null ? `${fmtNumber(stats.maxTorque)} Nm` : '—',
        temperature: formatTemperature(stats?.maxMotorTemp),
      }),
    },
    {
      title: t('dynamics.powertrain.inputs', 'Driver inputs'),
      text: t('dynamics.powertrain.inputsEvidence', 'Motor power does not establish pedal position or braking technique. Pedal, G-force, gear, and cruise panels below show current vehicle signals, not this trip’s historical inputs.'),
    },
  ];

  return (
    <GlassPanel className="min-w-0 p-4 sm:p-6" data-testid="dynamics-powertrain-summary">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--theme-primary)]" aria-hidden="true" />
          {t('dynamics.powertrain.title', 'Powertrain summary')}
        </PanelTitle>
        <Badge variant="neutral" size="sm">{t('dynamics.powertrain.scope', 'Selected-drive evidence')}</Badge>
      </div>
      <Text as="p" variant="caption" className="mt-2 mb-4">
        {t('dynamics.powertrain.coverage', 'Up to {{limit}} motor samples inside the selected drive. Averages describe reported samples, not a time-weighted or complete-trip assessment.', { limit: MOTOR_HISTORY_LIMIT })}
      </Text>
      {query.isLoading ? (
        <div role="status" aria-label={t('dynamics.powertrain.loading', 'Loading selected-drive evidence')}>
          <Skeleton className="h-24" />
        </div>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={query.refetch} />
      ) : stats ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.title} className="min-w-0 border-t border-[var(--border-default)] pt-4">
              <Text as="p" variant="bodySm" weight="semibold">{fact.title}</Text>
              <Text as="p" variant="bodySm" color="secondary" className="mt-2">{fact.text}</Text>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState /* no-action: recorded telemetry cannot be backfilled from live readings */
          message={t('dynamics.powertrain.empty', 'No motor samples in this drive window. Trip totals remain available above; current readings are kept separate below.')}
        />
      )}
    </GlassPanel>
  );
}
