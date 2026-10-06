import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { MotorHistoryQuery } from '@/api/hooks/useVehicles';
import { useMotorEvidence } from './useMotorEvidence';

interface DrivingTipsProps {
  vehicleId: number | null | undefined;
  historyQuery?: MotorHistoryQuery;
}

/** Preserve each evidence condition and specialist explanation. */
export default function DrivingTips({ vehicleId, historyQuery }: DrivingTipsProps) {
  const { t } = useTranslation();
  const { query, state, motorStats } = useMotorEvidence(vehicleId, historyQuery);
  const tips = useMemo(() => {
    const list: { id: string; text: string; tone: 'info' }[] = [];
    if (!motorStats) return list;
    if (motorStats.avgPower != null) list.push({
      id: 'power-context', tone: 'info',
      text: t('dynamics.guidance.power', 'Compare power peaks with the trip’s speed and road conditions. Average motor power alone cannot tell whether acceleration was smooth or efficient.'),
    });
    if (motorStats.peakRegen != null) list.push({
      id: 'regen-context', tone: 'info',
      text: t('dynamics.guidance.regen', 'Review energy recovered alongside energy used. A peak regen reading is not a measure of braking quality, and friction-brake use cannot be reconstructed from motor power.'),
    });
    if (motorStats.maxTorque != null) list.push({
      id: 'torque-context', tone: 'info',
      text: t('dynamics.guidance.torque', 'Use the front and rear torque traces to see which axle reported load. Gaps are missing telemetry, not evidence that an axle was inactive.'),
    });
    if (motorStats.maxMotorTemp != null) list.push({
      id: 'thermal-context', tone: 'info',
      text: t('dynamics.guidance.thermal', 'Temperature adds context to sustained motor load. Without the vehicle’s limiting signals, these samples do not prove overheating or reduced power.'),
    });
    return list;
  }, [motorStats, t]);

  return (
    <LayoutCard title={t('dynamics.guidance.title', 'How to read this ride')}>
      <StaleRefreshWarning state={state} label={t('dynamics.guidance.title', 'How to read this ride')} />
      {state.fatalError ? <QueryError error={state.fatalError} onRetry={() => void query.refetch()} /> : null}
      {query.isLoading && !state.hasData ? <Skeleton className="h-20" /> : tips.length > 0 ? (
        <ul className="grid min-w-0 grid-cols-1 gap-3 @xl:grid-cols-2 @5xl:grid-cols-3">
          {tips.map(tip => (
            <li key={tip.id} data-tone={tip.tone}
              className="min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
              <Text as="span" size="sm" color="secondary">{tip.text}</Text>
            </li>
          ))}
        </ul>
      ) : state.fatalError ? null : (
        // no-action: Disabled history awaits a valid trip selection in the trip toolbar.
        <EmptyState message={t('dynamics.guidance.empty', 'No measured motor evidence available for trip-specific guidance.')}
          action={vehicleId && historyQuery?.enabled !== false
            ? { label: t('common.retry', 'Retry'), onClick: () => void query.refetch() } : undefined} />
      )}
    </LayoutCard>
  );
}
