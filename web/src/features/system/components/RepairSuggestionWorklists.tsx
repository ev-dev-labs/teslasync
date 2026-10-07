import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging, Route } from 'lucide-react';
import {
  repairApplyInput,
  useApplyChargingRepair,
  useApplyDriveRepair,
  type RepairSuggestion,
} from '@/api/hooks/useDataRepair';
import { RepairSuggestionSection } from './RepairSuggestionSection';

interface RepairSuggestionWorklistsProps {
  driveSuggestions: RepairSuggestion[];
  chargingSuggestions: RepairSuggestion[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  canWrite: boolean;
  writeBlockReason?: string;
  onRetry: () => void;
}

function rowKey(suggestion: RepairSuggestion): string {
  return `${suggestion.kind}-${suggestion.session_id}`;
}

function errorText(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return undefined;
}

export function RepairSuggestionWorklists({
  driveSuggestions,
  chargingSuggestions,
  isLoading,
  isError,
  error,
  canWrite,
  writeBlockReason,
  onRetry,
}: RepairSuggestionWorklistsProps) {
  const { t } = useTranslation();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<string[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const applyDrive = useApplyDriveRepair();
  const applyCharging = useApplyChargingRepair();

  const handleApply = (suggestion: RepairSuggestion) => {
    const key = rowKey(suggestion);
    setPendingKey(key);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

    const mutation = suggestion.kind === 'drive' ? applyDrive : applyCharging;
    mutation.mutate(repairApplyInput(suggestion), {
      onSuccess: () => {
        setPendingKey(null);
        setAppliedKeys((current) => (
          current.includes(key) ? current : [...current, key]
        ));
      },
      onError: (mutationError) => {
        setPendingKey(null);
        setRowErrors((current) => ({
          ...current,
          [key]: errorText(mutationError) ?? t(
            'dataRepair.card.genericError',
            'The repair was rejected. Refresh and review again.',
          ),
        }));
      },
    });
  };

  const sharedProps = {
    isLoading,
    isError,
    error,
    onRetry,
    pendingKey,
    appliedKeys,
    rowErrors,
    onApply: handleApply,
    disabled: !canWrite,
    disabledReason: writeBlockReason,
  };

  return (
    <section
      aria-label={t('dataRepair.suggestionsRegion', 'Suggested repairs')}
      className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-2 2xl:gap-5"
    >
      <RepairSuggestionSection
        {...sharedProps}
        items={driveSuggestions}
        title={t('dataRepair.drives.suggestionsTitle', 'Drive Boundaries')}
        emptyTitle={t('dataRepair.drives.suggestionsEmptyTitle', 'No contradicted drive boundaries')}
        emptyMessage={t(
          'dataRepair.drives.suggestionsEmpty',
          'Every drive in the scanned window agrees with the durable signal history.',
        )}
        icon={<Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      />
      <RepairSuggestionSection
        {...sharedProps}
        items={chargingSuggestions}
        title={t('dataRepair.charging.suggestionsTitle', 'Charging Boundaries')}
        emptyTitle={t(
          'dataRepair.charging.suggestionsEmptyTitle',
          'No contradicted charging boundaries',
        )}
        emptyMessage={t(
          'dataRepair.charging.suggestionsEmpty',
          'Every charging session in the scanned window agrees with the durable signal history.',
        )}
        icon={<BatteryCharging className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      />
    </section>
  );
}
