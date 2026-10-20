import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';
import { typography } from '@/lib/tokens';
import {
  GlassPanel, Button, Input, Slider, Toggle, Badge,
  PanelTitle, Text, Caption, ErrorText, Select,
} from '@/components/ui';
import { OperationalWriteNotice, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { SourceContent } from '@/components/layout';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import {
  useComfortNext,
  useComfortRuns,
  useSaveComfortConfig,
  usePreconditionNow,
} from '@/api/hooks/useComfort';
export function ComfortPanel() {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { formatTemperature } = useUnits();
  const { vehicleId, vehicles = [], vehiclesState, setVehicleId } = useSelectedVehicle();
  const operationalMode = useOperationalMode();
  const nextQuery = useComfortNext(vehicleId);
  const nextState = useDataState(nextQuery);
  const runsQuery = useComfortRuns(vehicleId);
  const runsState = useDataState(runsQuery, { provenance: 'historical' });
  const saveMutation = useSaveComfortConfig();
  const nowMutation = usePreconditionNow();
  const stored = nextQuery.data?.config;
  const [enabled, setEnabled] = useState(false);
  const [targetTemp, setTargetTemp] = useState(21);
  const [leadMinutes, setLeadMinutes] = useState(20);
  const [icsUrl, setIcsUrl] = useState('');
  const [hydratedVehicleId, setHydratedVehicleId] = useState<number | null>(null);
  useEffect(() => {
    if (stored?.vehicle_id === vehicleId && hydratedVehicleId !== vehicleId) {
      setEnabled(stored.enabled);
      setTargetTemp(stored.target_temp_c);
      setLeadMinutes(stored.lead_minutes);
      setIcsUrl(stored.ics_url);
      setHydratedVehicleId(vehicleId);
    }
  }, [stored, vehicleId, hydratedVehicleId]);
  const nextEvent = nextQuery.data?.event;
  const runs = runsQuery.data ?? [];
  const busy = saveMutation.isPending || nowMutation.isPending;
  const canAct = operationalMode.canWrite && vehicleId != null
    && vehicles.some((vehicle) => vehicle.id === vehicleId)
    && stored?.vehicle_id === vehicleId && hydratedVehicleId === vehicleId && !busy;
  const noVehicle = t('comfort.noVehicle', 'Select a vehicle to configure cabin comfort.');
  const statusError = t('comfort.statusError', 'Comfort status unavailable.');
  const recentLabel = t('comfort.recent', 'Recent runs');
  const emptyRuns = vehicleId == null ? noVehicle
    : t('common.emptyResultsForTitle', 'No {{title}} found.', { title: recentLabel });
  const nextSourceState = vehicleId == null ? 'empty'
    : nextState.fatalError ? 'error' : !nextState.hasData ? 'loading' : 'ready';
  const handleSave = () => {
    if (!canAct || vehicleId == null) return;
    saveMutation.mutate({
      vehicle_id: vehicleId,
      enabled,
      target_temp_c: targetTemp,
      lead_minutes: leadMinutes,
      ics_url: icsUrl.trim(),
    });
  };
  const saveError = saveMutation.isError && saveMutation.variables?.vehicle_id === vehicleId
      ? (saveMutation.error as Error)?.message || t('comfort.saveError', 'Save failed')
      : '';
  const nowError = nowMutation.isError && nowMutation.variables === vehicleId
      ? (nowMutation.error as Error)?.message || t('comfort.nowError', 'Precondition failed')
      : '';
  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Icons.climateHot className={`h-4 w-4 ${typography.color.secondary}`} aria-hidden="true" />
          {t('comfort.title', 'Cabin comfort Autopilot')}
        </PanelTitle>
        {stored && (
          <Badge variant={stored.enabled ? 'success' : 'neutral'} size="sm">
            {stored.enabled
              ? t('comfort.armed', 'Armed')
              : t('comfort.disarmed', 'Off')}
          </Badge>
        )}
      </div>
      <Select
        label={t('common.vehicle', 'Vehicle')}
        value={vehicleId == null ? '' : String(vehicleId)}
        options={vehicles.map((vehicle) => ({
          value: String(vehicle.id),
          label: vehicle.display_name || `${t('common.vehicle', 'Vehicle')} ${vehicle.id}`,
        }))}
        onChange={(event) => {
          const id = Number(event.target.value);
          if (vehicles.some((vehicle) => vehicle.id === id)) setVehicleId(id);
        }}
        disabled={busy || vehicles.length === 0}
      />
      {vehiclesState?.fatalError && <QueryError error={vehiclesState.fatalError} onRetry={vehiclesState.retry ?? undefined} />}
      {vehiclesState?.status === 'initial' && <Skeleton height={44} />}
      {vehiclesState?.status === 'unavailable' && <Caption>{noVehicle}</Caption>}
      {vehiclesState && <StaleRefreshWarning state={vehiclesState} label={t('common.vehicle', 'Vehicle')} />}
      <OperationalWriteNotice />
      <div className="space-y-3">
        <SourceContent state={nextSourceState} label={t('comfort.title', 'Cabin comfort Autopilot')}
          emptyMessage={noVehicle} errorMessage={statusError} error={nextState.fatalError}
          errorRecovery={{ onRetry: nextState.retry ?? undefined }}>
          <StaleRefreshWarning state={nextState} label={t('comfort.title', 'Cabin comfort Autopilot')} />
          {nextEvent ? (
            <div className="flex min-w-0 items-center gap-2">
              <Icons.calendarClock className={`h-4 w-4 shrink-0 ${typography.color.secondary}`} aria-hidden="true" />
              <Text variant="bodySm" className="break-words">
                {t('comfort.nextEvent', '{{title}} at {{when}} — {{where}}', {
                  title: nextEvent.title || t('comfort.untitled', 'Untitled event'),
                  when: formatDateTime(nextEvent.starts_at),
                  where: nextEvent.location,
                })}
              </Text>
            </div>
          ) : (
            <Caption>
              {stored?.ics_url
                ? t('comfort.noUpcoming', 'No offsite events inside the lead window.')
                : t('comfort.noFeed', 'Add a calendar subscription to watch for events.')}
            </Caption>
          )}
        </SourceContent>
      </div>
      <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
        <SourceContent state={nextSourceState} label={t('common.vehicleConfig', 'Vehicle configuration')}
          emptyMessage={noVehicle} errorMessage={statusError} error={nextState.fatalError}
          errorRecovery={{ onRetry: nextState.retry ?? undefined }}>
          <Toggle label={t('comfort.arm', 'Precondition before calendar events')}
            checked={enabled} onChange={setEnabled} disabled={!canAct} />
          <Input label={t('comfort.icsUrl', 'Calendar subscription URL (ICS)')}
            value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)}
            placeholder="https://calendar.example.com/feed.ics" inputMode="url" disabled={!canAct} />
          <Slider label={t('comfort.targetTemp', 'Cabin target temperature')}
            value={targetTemp} min={15} max={28} onChange={setTargetTemp}
            formatValue={formatTemperature} disabled={!canAct} />
          <Slider label={t('comfort.lead', 'Precondition lead time')}
            value={leadMinutes} min={5} max={120} step={5} onChange={setLeadMinutes}
            formatValue={(v) => `${v} ${t('common.min', 'min')}`} disabled={!canAct} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSave} disabled={!canAct} loading={saveMutation.isPending}>
              {t('comfort.save', 'Save Autopilot')}
            </Button>
            <Button variant="secondary"
              onClick={() => canAct && vehicleId != null && nowMutation.mutate(vehicleId)}
              disabled={!canAct} loading={nowMutation.isPending}
              icon={<Icons.charging className="h-4 w-4" aria-hidden="true" />} className="gap-2">
              {t('comfort.now', 'Precondition now')}
            </Button>
          </div>
          {saveError && <ErrorText>{saveError}</ErrorText>}
          {nowError && <ErrorText>{nowError}</ErrorText>}
        </SourceContent>
      </div>
      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
        <Text variant="bodySm">{recentLabel}</Text>
        <SourceContent
          state={vehicleId == null ? 'empty' : runsState.fatalError ? 'error'
            : !runsState.hasData ? 'loading' : runs.length === 0 ? 'empty' : 'ready'}
          label={recentLabel} emptyMessage={emptyRuns}
          errorMessage={statusError} error={runsState.fatalError}
          errorRecovery={{ onRetry: runsState.retry ?? undefined }}
          emptyContent={<>
            <StaleRefreshWarning state={runsState} label={recentLabel} />
            <Caption>{emptyRuns}</Caption>
          </>}>
          <StaleRefreshWarning state={runsState} label={recentLabel} />
          <Caption>
            {t('pagination.showing', 'Showing {{start}}–{{end}} of {{total}}', {
              start: 1, end: Math.min(5, runs.length), total: runs.length,
            })}
          </Caption>
          <ul className="space-y-1.5">
            {runs.slice(0, 5).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <Caption className="min-w-0 break-words">
                  {r.event_title || t('comfort.untitled', 'Untitled event')}
                </Caption>
                <Caption className="shrink-0 tabular-nums">{formatDateTime(r.acted_at)}</Caption>
              </li>
            ))}
          </ul>
        </SourceContent>
      </div>
    </GlassPanel>
  );
}
