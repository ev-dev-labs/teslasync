/**
 * SignalLogViewerPage — query signal history from Postgres.
 *
 * Refactored to compose the shared `SignalSelector` + `SignalHistoryTable`
 * components so the page stays in lockstep with the unified `/signals`
 * workspace. Now drives `vehicleId` from `useSelectedVehicle` instead of
 * the previous hard-coded `1`.
 *
 * deferred-filter:no server-driven — the page only fetches when the user
 * clicks Query; pagination is local slicing of the already-fetched batch
 * (≤500 rows per page), which is cheap.
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Database, AlertCircle, Activity } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AlertBanner } from '@/components/feedback';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { getErrorMessage } from '@/lib/errorMessage';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUrlArray } from '@/hooks/useUrlState';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSignals } from '@/api/hooks/useTelemetry';
import { request } from '@/api/client';
import { adaptSignalHistoryResp, type SignalLogEntry } from '@/components/SignalQueryControls';
import type { SignalHistoryResp } from '@/api/types';

import { SignalSelector } from '../components/SignalSelector';
import { SignalHistoryTable } from '../components/SignalHistoryTable';

const PER_PAGE_OPTIONS = [
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '500', label: '500' },
];

export default function SignalLogViewerPage() {
  const { t } = useTranslation();
  usePageTitle(t('Signal Log'));

  const { vehicleId: storeVehicleId } = useSelectedVehicle();
  const vehicleId = storeVehicleId ?? 0;

  const { data: availableSignals } = useSignals(vehicleId);
  const [selectedSignals, setSelectedSignals] = useUrlArray('signals');

  const { start, end, setRange } = useRangeState({
    persistKey: 'signal-log.range',
    defaultPresetId: 'today',
  });

  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);
  const [queryKey, setQueryKey] = useState<number | null>(null);

  const canQuery = selectedSignals.length > 0 && !!start && !!end && vehicleId > 0;

  const handleQuery = useCallback(() => {
    if (!canQuery) return;
    setPage(1);
    setQueryKey(Date.now());
  }, [canQuery]);

  const fromIso = useMemo(
    () => (start ? new Date(`${start}T00:00:00`).toISOString() : ''),
    [start],
  );
  const toIso = useMemo(
    () => (end ? new Date(`${end}T23:59:59.999`).toISOString() : ''),
    [end],
  );

  const { data: allRows, isLoading, isFetching, error: dataError } = useQuery<SignalLogEntry[]>({
    queryKey: ['signal-log', vehicleId, queryKey],
    queryFn: async () => {
      const results = await Promise.all(
        selectedSignals.map((sig) =>
          request<SignalHistoryResp>(
            `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=${perPage * 10}`,
          ),
        ),
      );
      return results
        .flatMap((resp) => adaptSignalHistoryResp(resp))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    },
    enabled: queryKey !== null,
  });

  const anyError = dataError as Error | undefined;
  const totalRecords = (allRows ?? []).length;
  const rows = useMemo(() => {
    const startIdx = (page - 1) * perPage;
    return (allRows ?? []).slice(startIdx, startIdx + perPage);
  }, [allRows, page, perPage]);
  const hasQueried = queryKey !== null;

  return (
    <PageContainer
      title={t('Signal Log Viewer')}
      subtitle={t('Query signal history from Postgres')}
      actions={<VehicleSelect />}
      copyLink
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {vehicleId === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t('signalLog.noVehicle', 'Select a vehicle to begin')}
          message={t('signalLog.noVehicleDesc', 'Pick a vehicle from the picker above to query its signal history.')}
        />
      ) : (
        <>
          <GlassPanel className="p-4 sm:p-5 space-y-4">
            <SignalSelector
              options={availableSignals ?? []}
              value={selectedSignals}
              onChange={setSelectedSignals}
              max={null}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="space-y-1">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {t('Time Range')}
                </span>
                <RangePicker
                  value={{ start, end }}
                  onChange={setRange}
                  presetIds={['today', 'yesterday', '7d', '30d', '90d', 'all']}
                  align="start"
                  triggerTestId="signal-log-range"
                />
              </label>
              <div className="flex items-end gap-3">
                <Select
                  label={t('Per Page')}
                  value={String(perPage)}
                  onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
                  options={PER_PAGE_OPTIONS}
                  className="w-24"
                />
                <Button
                  variant="primary"
                  icon={<Database className="h-4 w-4" />}
                  onClick={handleQuery}
                  disabled={!canQuery}
                  loading={isFetching}
                >
                  {t('Query')}
                </Button>
                {hasQueried ? (
                  <span className="text-xs text-[var(--text-muted)] pb-2">
                    {totalRecords} {t('records')}
                  </span>
                ) : null}
              </div>
            </div>
          </GlassPanel>

          {!hasQueried ? (
            <EmptyState
              icon={<Database className="h-10 w-10" />}
              title={t('Select signals and click Query')}
              message={t('Choose one or more signals, set a date range, then hit Query to browse signal history.')}
            />
          ) : (
            <SignalHistoryTable
              rows={rows}
              selectedSignals={selectedSignals}
              page={page}
              pageSize={perPage}
              totalRows={totalRecords}
              onPageChange={setPage}
              loading={isLoading}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
