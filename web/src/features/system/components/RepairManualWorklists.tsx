import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  StaleChargingSession,
  StaleDrive,
} from '@/api/hooks/useDataRepair';
import { Text } from '@/components/ui';
import { StaleChargingWorklist } from './StaleChargingWorklist';
import { StaleDriveWorklist } from './StaleDriveWorklist';

interface RepairManualWorklistsProps {
  staleCharging: StaleChargingSession[];
  staleDrives: StaleDrive[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  canWrite: boolean;
  writeBlockReason?: string;
  onRetry: () => void;
}

export function RepairManualWorklists({
  staleCharging,
  staleDrives,
  isLoading,
  isError,
  error,
  canWrite,
  writeBlockReason,
  onRetry,
}: RepairManualWorklistsProps) {
  const { t } = useTranslation();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const totalStale = staleCharging.length + staleDrives.length;

  useEffect(() => {
    if (!canWrite) setExpandedKey(null);
  }, [canWrite]);

  const toggle = (key: string) => {
    if (canWrite) setExpandedKey((current) => (current === key ? null : key));
  };

  const sharedProps = {
    isLoading,
    isError,
    error,
    onRetry,
    expandedKey,
    onToggle: toggle,
    onCollapse: () => setExpandedKey(null),
    disabled: !canWrite,
    disabledReason: writeBlockReason,
  };

  return (
    <section aria-label={t('dataRepair.worklist', 'Repair worklist')} className="space-y-3">
      <Text as="p" variant="bodySm">
        {t(
          'dataRepair.stale.intro',
          'Incomplete sessions with no contradicting evidence. These are listed for manual inspection only — nothing in the recorded history establishes where they should end.',
        )}
        {totalStale > 0 ? ` (${totalStale})` : ''}
      </Text>
      <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-2 2xl:gap-5">
        <StaleChargingWorklist {...sharedProps} sessions={staleCharging} />
        <StaleDriveWorklist {...sharedProps} drives={staleDrives} />
      </div>
    </section>
  );
}
