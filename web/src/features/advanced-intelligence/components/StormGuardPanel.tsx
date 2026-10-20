/**
 * Storm Guardian panel — arm/disarm severe-weather auto-prep, set the home
 * coordinates + pre-storm charge target, and show the live assessment with
 * the recent action log. Mirrors AutopilotPanel structure (status header,
 * config form, timeline) so both autopilots read as one product.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icons } from '@/lib/icons';

import {
  GlassPanel,
  Button,
  Input,
  Slider,
  Toggle,
  Badge,
  PanelTitle,
  Text,
  Caption,
  ErrorText,
} from '@/components/ui';
import { DataSourceNotice, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { useStormguardStatus, useStormguardEvents, useSaveStormguardConfig } from '@/api/hooks/useStormguard';
import { useUnits } from '@/hooks/useUnits';
import { StormGuardActivity } from './StormGuardActivity';
import { stormLevelLabel, stormLevelVariant } from './stormguardPresentation';

interface StormGuardDraft {
  enabled: boolean;
  lat: string;
  lng: string;
  targetSoc: number;
}

const defaultDraft: StormGuardDraft = {
  enabled: false, lat: '37.7749', lng: '-122.4194', targetSoc: 90,
};

const validCoordinate = (value: string, limit: number) =>
  value.trim() !== '' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;

export function StormGuardPanel({ vehicleId }: { vehicleId?: number | null }) {
  const { formatSpeed } = useUnits();
  const { t } = useTranslation();
  const statusQuery = useStormguardStatus(vehicleId);
  const statusState = useDataState(statusQuery);
  const eventsQuery = useStormguardEvents(vehicleId);
  const saveMutation = useSaveStormguardConfig();
  const stored = statusQuery.data?.config;
  const [drafts, setDrafts] = useState<Record<number, StormGuardDraft>>({});
  const [validationVehicleId, setValidationVehicleId] = useState<number | null>(null);
  const { enabled, lat, lng, targetSoc } = (vehicleId != null && drafts[vehicleId]) || defaultDraft;
  const { reset } = saveMutation;
  useEffect(() => {
    // Detach the mutation observer from work submitted in the previous scope.
    reset();
    setValidationVehicleId(null);
  }, [vehicleId, reset]);

  useEffect(() => {
    if (!stored || stored.vehicle_id !== vehicleId) return;
    setDrafts((previous) => previous[stored.vehicle_id] ? previous : {
      ...previous,
      [stored.vehicle_id]: {
        enabled: stored.enabled, lat: String(stored.lat),
        lng: String(stored.lng), targetSoc: stored.target_soc,
      },
    });
  }, [stored, vehicleId]);

  const updateDraft = (patch: Partial<StormGuardDraft>) => {
    if (vehicleId == null) return;
    setDrafts((previous) => ({
      ...previous, [vehicleId]: { ...(previous[vehicleId] ?? defaultDraft), ...patch },
    }));
  };

  const matchingStatus = stored?.vehicle_id === vehicleId ? statusQuery.data : undefined;
  const assessment = matchingStatus?.assessment;
  const currentSoc = matchingStatus?.current_soc;
  const matchingSave = vehicleId != null && saveMutation.variables?.vehicle_id === vehicleId;
  const savePending = matchingSave && saveMutation.isPending;
  const latValid = validCoordinate(lat, 90);
  const lngValid = validCoordinate(lng, 180);
  const showValidation = vehicleId != null && validationVehicleId === vehicleId;
  const handleSave = () => {
    if (!vehicleId || savePending) return;
    setValidationVehicleId(vehicleId);
    if (!latValid || !lngValid) return;
    saveMutation.mutate({
      vehicle_id: vehicleId,
      enabled,
      lat: Number(lat),
      lng: Number(lng),
      target_soc: targetSoc,
    });
  };

  const saveError =
    matchingSave && saveMutation.isError
      ? (saveMutation.error as Error)?.message || t('stormguard.saveError', 'Save failed')
      : '';

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Icons.cloudLightning className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          {t('stormguard.title', 'Storm guardian')}
        </PanelTitle>
        {assessment && (
          <Badge variant={stormLevelVariant(assessment.level)} size="sm" className="gap-1">
            {assessment.level === 'none' ? (
              <Icons.securityCheck className="h-3.5 w-3.5" aria-hidden="true" />
            ) : assessment.level === 'watch' || assessment.level === 'warning' ? (
              <Icons.warning className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Icons.info className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {stormLevelLabel(t, assessment.level)}
          </Badge>
        )}
      </div>

      {!vehicleId ? (
        <Text variant="bodySm" color="secondary">
          {t('stormguard.noVehicle', 'Select a vehicle to configure storm protection.')}
        </Text>
      ) : statusState.fatalError ? (
        <QueryError error={statusState.fatalError} onRetry={() => statusState.retry?.()} />
      ) : statusState.status === 'initial' ? (
        statusState.isRefreshBlocked ? (
          <DataSourceNotice sources={[{
            id: 'stormguard-status',
            label: t('stormguard.title', 'Storm guardian'),
            query: statusQuery,
          }]} />
        ) : statusQuery.isLoading || statusQuery.isFetching || statusQuery.fetchStatus === 'fetching' ? (
          <div role="status" aria-busy="true" aria-label={t('dataSources.status.loading', 'Loading')}>
            <Skeleton height={180} />
          </div>
        ) : (
          <Text variant="bodySm" color="secondary" role="status">
            {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
          </Text>
        )
      ) : !assessment ? (
        <ErrorText>{t('stormguard.statusError', 'Weather assessment unavailable.')}</ErrorText>
      ) : (
        <>
          <StaleRefreshWarning state={statusState} />
          <Text variant="bodySm">{assessment.reason}</Text>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Caption className="tabular-nums">
              {t('stormguard.peakGustFormatted', 'Peak gust {{gust}}', {
                gust: formatSpeed(assessment.peak_gust_ms),
              })}
            </Caption>
            {currentSoc != null && (
              <Caption className="tabular-nums">
                {t('stormguard.currentSoc', 'Battery {{soc}}%', { soc: currentSoc })}
              </Caption>
            )}
          </div>

          <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
            <Toggle
              label={t('stormguard.arm', 'Auto pre-charge before storms')}
              checked={enabled}
              onChange={(value) => updateDraft({ enabled: value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('stormguard.lat', 'Home latitude')}
                value={lat}
                onChange={(e) => updateDraft({ lat: e.target.value })}
                inputMode="decimal"
                error={showValidation && !latValid
                  ? t('stormguard.latError', 'Enter a finite latitude between -90 and 90.')
                  : undefined}
              />
              <Input
                label={t('stormguard.lng', 'Home longitude')}
                value={lng}
                onChange={(e) => updateDraft({ lng: e.target.value })}
                inputMode="decimal"
                error={showValidation && !lngValid
                  ? t('stormguard.lngError', 'Enter a finite longitude between -180 and 180.')
                  : undefined}
              />
            </div>
            <Slider
              label={t('stormguard.target', 'Pre-storm charge target')}
              value={targetSoc}
              min={50}
              max={100}
              onChange={(value) => updateDraft({ targetSoc: value })}
              formatValue={(v) => `${v}%`}
            />
            <Button
              onClick={handleSave}
              disabled={!vehicleId || savePending}
              loading={savePending}
            >
              {t('stormguard.save', 'Save guard')}
            </Button>
            {saveError && <ErrorText>{saveError}</ErrorText>}
          </div>
        </>
      )}
      {vehicleId != null && (
        <StormGuardActivity query={eventsQuery} />
      )}
    </GlassPanel>
  );
}
