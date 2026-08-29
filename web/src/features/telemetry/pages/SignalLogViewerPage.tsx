/**
 * SignalLogViewerPage — query signal history from Postgres.
 *
 * Modern-UI full-width redesign. Composes the shared signal primitives
 * (`SignalSelector`, `SignalChartPanel`, `SignalHistoryTable`) with a
 * derived KPI band (`SignalLogKpiBand`) and value-type breakdown
 * (`SignalLogBreakdownPanel`) into a responsive bento:
 *
 *   query cockpit → KPI band → (chart 2fr | breakdown 1fr) → history table
 *
 * The page only fetches when the user clicks Query; pagination is local
 * slicing of the already-fetched batch (≤ per-page × 10 rows per signal),
 * which is cheap. Every results section owns its loading/empty state.
 * `vehicleId` is driven by `useSelectedVehicle`.
 *
 * The submitted range is immutable and is never narrowed to satisfy a
 * downstream limit: `TransportAgreementPanel` receives the exact window the
 * operator submitted and renders an explicit seven-day agreement-limit state
 * for the 30/90-day/all presets instead of issuing a request the audit API
 * caps at 168 hours. Signal history itself keeps the full range.
 */

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, AlertCircle, Activity } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel, Button, Select, Label, Caption } from '@/components/ui';
import { EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { getErrorMessage } from '@/lib/errorMessage';
import { fmtInt } from '@/lib/numberFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUrlArray } from '@/hooks/useUrlState';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useSignals } from '@/api/hooks/useTelemetry';
import { useSignalHistoryBatch } from '@/api/hooks/useSignals';
import { adaptSignalHistoryPoint, type SignalLogEntry } from '@/components/SignalQueryControls';
import { DataProvenanceBadge } from '@/components/data-display';
import { useDataState } from '@/hooks/useDataState';

import { SignalSelector } from '../components/SignalSelector';
import { SignalChartPanel } from '../components/SignalChartPanel';
import { SignalHistoryTable } from '../components/SignalHistoryTable';
import { SignalLogKpiBand } from '../components/SignalLogKpiBand';
import { SignalLogBreakdownPanel } from '../components/SignalLogBreakdownPanel';
import { TransportAgreementPanel } from '../components/TransportAgreementPanel';
import {
  summarizeSignalLog,
  buildSignalChartData,
  buildSignalStats,
} from '../components/signalLogSummary';

const PER_PAGE_OPTIONS = [
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
  { value: '500', label: '500' },
];

interface SubmittedSignalQuery {
  revision: number;
  vehicleId: number;
  signals: string[];
  from: string;
  to: string;
  perPage: number;
  limit: number;
}

export default function SignalLogViewerPage() {
  const { t } = useTranslation();
  usePageTitle(t('signalLog.title', 'Signal Log Viewer'));

  const { vehicleId: storeVehicleId } = useSelectedVehicle();
  const vehicleId = storeVehicleId ?? 0;

  const { data: availableSignals, error: signalsError } = useSignals(vehicleId);
  const [selectedSignals, setSelectedSignals] = useUrlArray('signals');

  const { start, end, setRange } = useRangeState({
    persistKey: 'signal-log.range',
    defaultPresetId: 'today',
  });

  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);
  // deferred-filter:no — this page has no keystroke-driven client filter to
  // defer. Signal selection and time range are explicit query inputs that
  // only take effect when the user presses Run (setQueryKey), and paging is a
  // bounded slice() of the already-fetched result set. There is no free-text
  // input whose every character would re-filter a large list, so
  // useDeferredValue would defer nothing.
  const [submittedQuery, setSubmittedQuery] = useState<SubmittedSignalQuery | null>(null);

  const canQuery = selectedSignals.length > 0 && !!start && !!end && vehicleId > 0;

  const fromIso = useMemo(
    () => (start ? new Date(`${start}T00:00:00`).toISOString() : ''),
    [start],
  );
  const toIso = useMemo(
    () => (end ? new Date(`${end}T23:59:59.999`).toISOString() : ''),
    [end],
  );

  const handleQuery = useCallback(() => {
    if (!canQuery) return;
    setPage(1);
    setSubmittedQuery((current) => ({
      revision: (current?.revision ?? 0) + 1,
      vehicleId,
      signals: [...selectedSignals],
      from: fromIso,
      to: toIso,
      perPage,
      limit: perPage * 10,
    }));
  }, [canQuery, fromIso, perPage, selectedSignals, toIso, vehicleId]);

  const signalLogQuery = useSignalHistoryBatch(submittedQuery);
  const signalLogState = useDataState(signalLogQuery, { provenance: 'historical' });
  const { data: historyResponses, isLoading, isFetching, error: dataError } = signalLogQuery;

  const rowsAll = useMemo<SignalLogEntry[]>(
    () =>
      (historyResponses ?? [])
        .flatMap((response) =>
          response.data.map((point) => adaptSignalHistoryPoint(point, response.signal)),
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [historyResponses],
  );
  const hasQueried = submittedQuery !== null;
  const anyError = (signalsError ?? dataError) as Error | undefined;
  const resultSignals = submittedQuery?.signals ?? [];
  const resultPageSize = submittedQuery?.perPage ?? perPage;

  const summary = useMemo(
    () => summarizeSignalLog(rowsAll, resultSignals),
    [resultSignals, rowsAll],
  );
  const chartData = useMemo(() => buildSignalChartData(rowsAll), [rowsAll]);
  const chartStats = useMemo(() => buildSignalStats(rowsAll), [rowsAll]);

  const totalRecords = rowsAll.length;
  const pageRows = useMemo(() => {
    const startIdx = (page - 1) * resultPageSize;
    return rowsAll.slice(startIdx, startIdx + resultPageSize);
  }, [page, resultPageSize, rowsAll]);

  return (
    <PageContainer
      title={t('signalLog.title', 'Signal Log Viewer')}
      subtitle={t('signalLog.subtitle', 'Query signal history from Postgres')}
      actions={<VehicleSelect />}
      query={hasQueried ? signalLogQuery : undefined}
      copyLink
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {vehicleId === 0 ? (
        // no-action: vehicle picker is in the page header; no inline CTA needed.
        <EmptyState
          icon={<Activity className="h-8 w-8" aria-hidden="true" />}
          title={t('signalLog.noVehicle', 'Select a vehicle to begin')}
          message={t('signalLog.noVehicleDesc', 'Pick a vehicle from the picker above to query its signal history.')}
        />
      ) : (
        <>
          {/* 1 — Query cockpit: signal selector + range + rows + Query */}
          <FadeIn>
            <GlassPanel className="space-y-4 p-4 sm:p-5">
              <SignalSelector
                options={availableSignals ?? []}
                value={selectedSignals}
                onChange={setSelectedSignals}
                max={null}
              />

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <label className="space-y-1">
                  <Label className="block">{t('signalLog.timeRange', 'Time Range')}</Label>
                  <RangePicker
                    value={{ start, end }}
                    onChange={setRange}
                    presetIds={['today', 'yesterday', '7d', '30d', '90d', 'all']}
                    align="start"
                    triggerTestId="signal-log-range"
                  />
                </label>
                <div className="flex flex-wrap items-end gap-3">
                  <Select
                    label={t('signalLog.perPage', 'Per Page')}
                    value={String(perPage)}
                    onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
                    options={PER_PAGE_OPTIONS}
                    className="w-24"
                  />
                  <Button
                    variant="primary"
                    icon={<Database className="h-4 w-4" aria-hidden="true" />}
                    onClick={handleQuery}
                    disabled={!canQuery}
                    loading={isFetching}
                  >
                    {t('signalLog.query', 'Query')}
                  </Button>
                  {hasQueried ? (
                    <>
                      <DataProvenanceBadge
                        provenance={signalLogState.provenance}
                        status={signalLogState.status}
                        updatedAt={signalLogState.updatedAt}
                      />
                      <Caption className="pb-2">
                        {fmtInt(totalRecords)} {t('signalLog.records', 'records')}
                      </Caption>
                    </>
                  ) : null}
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* 2 — KPI band: derived counters, full-width responsive grid */}
          <SignalLogKpiBand summary={summary} loading={isLoading} />

          <TransportAgreementPanel
            vehicleId={submittedQuery?.vehicleId ?? 0}
            from={submittedQuery?.from ?? ''}
            to={submittedQuery?.to ?? ''}
            enabled={submittedQuery != null}
          />

          {/* 3 — Bento: signal chart (hero, 2fr) + value composition (1fr) */}
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
            <div className="xl:col-span-2">
              <SignalChartPanel
                selectedSignals={resultSignals}
                data={chartData}
                stats={chartStats}
                loading={isLoading}
                pointsLoaded={totalRecords}
                title={t('signalLog.chart', 'Signal Chart')}
              />
            </div>
            <SignalLogBreakdownPanel
              summary={summary}
              hasQueried={hasQueried}
              loading={isLoading}
            />
          </section>

          {/* 4 — Detail band: full-width paginated history table */}
          <SignalHistoryTable
            rows={pageRows}
            selectedSignals={resultSignals}
            page={page}
            pageSize={resultPageSize}
            totalRows={totalRecords}
            onPageChange={setPage}
            loading={isLoading}
          />
        </>
      )}
    </PageContainer>
  );
}
