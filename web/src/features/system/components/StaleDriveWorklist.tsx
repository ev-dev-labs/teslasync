import { CheckCircle, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StaleDrive } from '@/api/hooks/useDataRepair';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

import { DriveRepairForm } from './DriveRepairForm';
import { StaleSessionRow, type StaleRowMetric } from './StaleSessionRow';

interface StaleDriveWorklistProps {
  drives: StaleDrive[];
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

export function StaleDriveWorklist({
  drives,
  isLoading,
  isError,
  error,
  onRetry,
  expandedKey,
  onToggle,
  onCollapse,
  disabled,
  disabledReason,
}: StaleDriveWorklistProps) {
  const { t } = useTranslation();
  const { formatDistance, formatSpeed } = useUnits();
  const metrics = (drive: StaleDrive): StaleRowMetric[] => [
    {
      key: 'distance',
      label: t('dataRepair.metric.distance', 'Distance'),
      value: formatDistance(drive.distance_m),
    },
    {
      key: 'max',
      label: t('dataRepair.metric.maxSpeed', 'Max'),
      value: formatSpeed(drive.max_speed_mps),
    },
  ];

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('dataRepair.drives.title', 'Drives')}
        {drives.length > 0 && (
          <Badge variant="warning" size="sm">{drives.length}</Badge>
        )}
      </PanelTitle>
      {isLoading ? (
        <Skeleton height={44} lines={3} />
      ) : isError ? (
        <QueryError
          error={error}
          onRetry={onRetry}
          resourceName={t('dataRepair.drives.resource', 'Drives')}
        />
      ) : drives.length === 0 ? (
        // no-action: there are no stale drives to repair
        <EmptyState
          icon={<CheckCircle className="h-8 w-8" />}
          title={t('dataRepair.drives.emptyTitle', 'All drives are complete')}
          message={t('dataRepair.drives.empty', 'No stale drives found.')}
        />
      ) : (
        <ul className="space-y-2">
          {drives.map((drive) => {
            const key = `drive-${drive.id}`;
            const formId = `repair-form-${key}`;
            const expanded = expandedKey === key;
            return (
              <li key={drive.id}>
                <StaleSessionRow
                  id={drive.id}
                  timestamp={drive.start_ts}
                  batteryPct={drive.start_battery_pct}
                  vehicleId={drive.vehicle_id}
                  metrics={metrics(drive)}
                  expanded={expanded}
                  onToggle={() => onToggle(key)}
                  controlsId={formId}
                  disabled={disabled}
                  disabledReason={disabledReason}
                />
                {expanded && (
                  <DriveRepairForm
                    drive={drive}
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
