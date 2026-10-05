import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import { MOTOR_HISTORY_LIMIT } from '../driving-dynamics/useMotorStats';
import { useMotorEvidence } from './useMotorEvidence';

interface PowertrainSummaryProps {
  vehicleId: number | null | undefined;
  historyQuery: MotorHistoryQuery;
}

/** Measured evidence, never inferred style, health, or pedal inputs. */
export default function PowertrainSummary({ vehicleId, historyQuery }: PowertrainSummaryProps) {
  const { t } = useTranslation();
  const { formatPower, formatTemperature } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const { query, state, motorStats: stats } = useMotorEvidence(vehicleId, historyQuery);
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
    <div data-testid="dynamics-powertrain-summary" className="h-full min-w-0">
      <LayoutCard title={t('dynamics.powertrain.title', 'Powertrain summary')}
        actions={<Badge variant="neutral" size="sm">{t('dynamics.powertrain.scope', 'Selected-drive evidence')}</Badge>}>
        <Text as="p" variant="caption">
          {t('dynamics.powertrain.coverage', 'Up to {{limit}} motor samples inside the selected drive. Averages describe reported samples, not a time-weighted or complete-trip assessment.', { limit: MOTOR_HISTORY_LIMIT })}
        </Text>
        <StaleRefreshWarning state={state} label={t('dynamics.powertrain.title', 'Powertrain summary')} />
        {state.fatalError ? <QueryError error={state.fatalError} onRetry={() => void query.refetch()} /> : null}
        {query.isLoading && !state.hasData ? (
          <div role="status" aria-label={t('dynamics.powertrain.loading', 'Loading selected-drive evidence')}>
            <Skeleton className="h-24" />
          </div>
        ) : stats ? (
          <div className="grid min-w-0 grid-cols-1 gap-4 @3xl:grid-cols-3">
            {facts.map(fact => (
              <div key={fact.title} className="min-w-0 border-t border-[var(--border-default)] pt-4">
                <Text as="p" variant="bodySm" weight="semibold">{fact.title}</Text>
                <Text as="p" variant="bodySm" color="secondary" className="mt-2">{fact.text}</Text>
              </div>
            ))}
          </div>
        ) : state.fatalError ? null : (
          <EmptyState message={t('dynamics.powertrain.empty', 'No motor samples in this drive window. Trip totals remain available above; current readings are kept separate below.')} />
        )}
      </LayoutCard>
    </div>
  );
}
