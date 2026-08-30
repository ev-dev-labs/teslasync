import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, ScanSearch } from 'lucide-react';
import {
  useRepairSuggestions,
  useStaleSessions,
} from '@/api/hooks/useDataRepair';
import { AIDataRepairSuggestions } from '@/components/ai/AIDataRepairSuggestions';
import { Badge, Button, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { RepairDiagnosisOverview } from './RepairDiagnosisOverview';
import { RepairManualWorklists } from './RepairManualWorklists';
import { RepairSuggestionWorklists } from './RepairSuggestionWorklists';

interface RepairDiagnosticsWorkspaceProps {
  vehicleId?: number;
  canWrite: boolean;
  writeBlockReason?: string;
}

export function RepairDiagnosticsWorkspace({
  vehicleId,
  canWrite,
  writeBlockReason,
}: RepairDiagnosticsWorkspaceProps) {
  const { t } = useTranslation();
  const suggestionsQuery = useRepairSuggestions(
    vehicleId != null ? { vehicle_id: vehicleId } : undefined,
  );
  const staleQuery = useStaleSessions();
  const driveSuggestions = suggestionsQuery.data?.drive_suggestions ?? [];
  const chargingSuggestions = suggestionsQuery.data?.charging_suggestions ?? [];
  const totalSuggestions = driveSuggestions.length + chargingSuggestions.length;
  const blockedCount = useMemo(
    () => [...driveSuggestions, ...chargingSuggestions]
      .filter((suggestion) => !suggestion.applicable).length,
    [driveSuggestions, chargingSuggestions],
  );
  const staleCharging = useMemo(
    () => (staleQuery.data?.stale_charging ?? [])
      .filter((session) => vehicleId == null || session.vehicle_id === vehicleId),
    [staleQuery.data?.stale_charging, vehicleId],
  );
  const staleDrives = useMemo(
    () => (staleQuery.data?.stale_drives ?? [])
      .filter((drive) => vehicleId == null || drive.vehicle_id === vehicleId),
    [staleQuery.data?.stale_drives, vehicleId],
  );
  const isRefreshing = suggestionsQuery.isFetching || staleQuery.isFetching;
  const hasError = suggestionsQuery.isError || staleQuery.isError;

  const refreshAll = () => {
    void suggestionsQuery.refetch();
    void staleQuery.refetch();
  };

  return (
    <div className="space-y-4">
      <GlassPanel className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)] text-cyan-300 shadow-e1">
              <ScanSearch className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <PanelTitle id="repair-diagnostics-title">
                  {t('dataRepair.diagnostics.title', 'Direct evidence diagnostics')}
                </PanelTitle>
                <Badge variant={hasError ? 'danger' : isRefreshing ? 'info' : 'neutral'} dot>
                  {hasError
                    ? t('dataRepair.diagnostics.attention', 'Attention needed')
                    : isRefreshing
                      ? t('dataRepair.diagnostics.scanning', 'Scanning')
                      : t('dataRepair.diagnostics.ready', 'Ready')}
                </Badge>
              </div>
              <Text as="p" variant="bodySm" className="mt-1 max-w-3xl">
                {t(
                  'dataRepair.diagnostics.description',
                  'Inspect durable signal contradictions and manually review incomplete sessions. These deeper scans run only while this workspace is open.',
                )}
              </Text>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={refreshAll}
            loading={isRefreshing}
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            className="min-h-11 shrink-0"
            data-testid="data-repair-refresh"
            aria-label={t('common.refresh', 'Refresh')}
          >
            {t('common.refresh', 'Refresh')}
          </Button>
        </div>
      </GlassPanel>

      <RepairDiagnosisOverview
        totalSuggestions={totalSuggestions}
        driveSuggestions={driveSuggestions.length}
        chargingSuggestions={chargingSuggestions.length}
        blocked={blockedCount}
        truncated={suggestionsQuery.data?.truncated ?? false}
        loading={suggestionsQuery.isLoading}
      />
      <AIDataRepairSuggestions vehicleId={vehicleId} />
      <RepairSuggestionWorklists
        driveSuggestions={driveSuggestions}
        chargingSuggestions={chargingSuggestions}
        isLoading={suggestionsQuery.isLoading}
        isError={suggestionsQuery.isError}
        error={suggestionsQuery.error}
        onRetry={() => { void suggestionsQuery.refetch(); }}
        canWrite={canWrite}
        writeBlockReason={writeBlockReason}
      />
      <RepairManualWorklists
        staleCharging={staleCharging}
        staleDrives={staleDrives}
        isLoading={staleQuery.isLoading}
        isError={staleQuery.isError}
        error={staleQuery.error}
        onRetry={() => { void staleQuery.refetch(); }}
        canWrite={canWrite}
        writeBlockReason={writeBlockReason}
      />
    </div>
  );
}
