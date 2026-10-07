import { BatteryCharging, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StaleChargingSession } from '@/api/hooks/useDataRepair';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { ChargingRepairForm } from './ChargingRepairForm';
import { StaleSessionRow, type StaleRowMetric } from './StaleSessionRow';

interface StaleChargingWorklistProps {
  sessions: StaleChargingSession[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  expandedKey: string | null;
  onToggle: (key: string) => void;
  onCollapse: () => void;
  disabled: boolean;
  disabledReason?: string;
}

export function StaleChargingWorklist({
  sessions,
  isLoading,
  isError,
  error,
  onRetry,
  expandedKey,
  onToggle,
  onCollapse,
  disabled,
  disabledReason,
}: StaleChargingWorklistProps) {
  const { t } = useTranslation();
  const { formatEnergy, formatPower } = useUnits();
  const metrics = (session: StaleChargingSession): StaleRowMetric[] => [
    {
      key: 'energy',
      label: t('dataRepair.metric.energy', 'Energy'),
      value: formatEnergy(session.total_energy_added_wh),
    },
    {
      key: 'peak',
      label: t('dataRepair.metric.peak', 'Peak'),
      value: formatPower(session.peak_power_w),
    },
  ];

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <BatteryCharging className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('dataRepair.charging.title', 'Charging Sessions')}
        {sessions.length > 0 && (
          <Badge variant="warning" size="sm">{sessions.length}</Badge>
        )}
      </PanelTitle>
      {isLoading ? (
        <Skeleton height={44} lines={3} />
      ) : isError ? (
        <QueryError
          error={error}
          onRetry={onRetry}
          resourceName={t('dataRepair.charging.resource', 'Charging sessions')}
        />
      ) : sessions.length === 0 ? (
        // no-action: there are no stale charging sessions to repair
        <EmptyState
          icon={<CheckCircle className="h-8 w-8" />}
          title={t('dataRepair.charging.emptyTitle', 'All charging sessions are complete')}
          message={t('dataRepair.charging.empty', 'No stale charging sessions found.')}
        />
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => {
            const key = `charging-${session.id}`;
            const formId = `repair-form-${key}`;
            const expanded = expandedKey === key;
            return (
              <li key={session.id}>
                <StaleSessionRow
                  id={session.id}
                  timestamp={session.started_at}
                  batteryPct={session.start_soc_pct}
                  vehicleId={session.vehicle_id}
                  metrics={metrics(session)}
                  expanded={expanded}
                  onToggle={() => onToggle(key)}
                  controlsId={formId}
                  disabled={disabled}
                  disabledReason={disabledReason}
                />
                {expanded && (
                  <ChargingRepairForm
                    session={session}
                    formId={formId}
                    onClose={onCollapse}
                    disabled={disabled}
                    disabledReason={disabledReason}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
