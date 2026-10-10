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
import { DataStateNotice, QueryError, Skeleton } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import {
  useStormguardStatus,
  useStormguardEvents,
  useSaveStormguardConfig,
} from '@/api/hooks/useStormguard';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { StormGuardActivity } from './StormGuardActivity';
import { stormLevelLabel, stormLevelVariant } from './stormguardPresentation';

export function StormGuardPanel({ vehicleId }: { vehicleId?: number | null }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();

  const statusQuery = useStormguardStatus(vehicleId);
  const statusState = useDataState(statusQuery);
  const eventsQuery = useStormguardEvents(vehicleId);
  const saveMutation = useSaveStormguardConfig();

  const stored = statusQuery.data?.config;
  const [enabled, setEnabled] = useState(false);
  const [lat, setLat] = useState('37.7749');
  const [lng, setLng] = useState('-122.4194');
  const [targetSoc, setTargetSoc] = useState(90);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (stored && !hydrated) {
      setEnabled(stored.enabled);
      setLat(String(stored.lat));
      setLng(String(stored.lng));
      setTargetSoc(stored.target_soc);
      setHydrated(true);
    }
  }, [stored, hydrated]);

  const assessment = statusQuery.data?.assessment;
  const currentSoc = statusQuery.data?.current_soc;

  const handleSave = () => {
    if (!vehicleId) return;
    saveMutation.mutate({
      vehicle_id: vehicleId,
      enabled,
      lat: Number(lat),
      lng: Number(lng),
      target_soc: targetSoc,
    });
  };

  const saveError =
    saveMutation.isError
      ? (saveMutation.error as Error)?.message || t('stormguard.saveError', 'Save failed')
      : '';

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Icons.cloudLightning className="h-4 w-4 text-amber-300" aria-hidden="true" />
          {t('stormguard.title', 'Storm guardian')}
        </PanelTitle>
        {assessment && (
          <Badge variant={stormLevelVariant(assessment.level)} size="sm" className="gap-1">
            {assessment.level === 'none' ? (
              <Icons.securityCheck className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Icons.warning className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {stormLevelLabel(t, assessment.level)}
          </Badge>
        )}
      </div>

      {!vehicleId ? (
        <Text variant="bodySm" color="secondary">
          {t('stormguard.noVehicle', 'Select a vehicle to configure storm protection.')}
        </Text>
      ) : statusQuery.isLoading && !statusState.hasData ? (
        <Skeleton height={180} />
      ) : statusState.fatalError || !assessment ? (
        statusState.fatalError ? (
          <QueryError error={statusState.fatalError} onRetry={() => statusState.retry?.()} />
        ) : (
          <ErrorText>{t('stormguard.statusError', 'Weather assessment unavailable.')}</ErrorText>
        )
      ) : (
        <>
          {statusState.status === 'stale' && (
            <DataStateNotice state="stale" preserveSeverity />
          )}
          <Text variant="bodySm">{assessment.reason}</Text>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <Caption className="tabular-nums">
              {t('stormguard.peakGust', 'Peak gust {{gust}} m/s', {
                gust: fmtNumber(assessment.peak_gust_ms),
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
              onChange={setEnabled}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('stormguard.lat', 'Home latitude')}
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                inputMode="decimal"
              />
              <Input
                label={t('stormguard.lng', 'Home longitude')}
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <Slider
              label={t('stormguard.target', 'Pre-storm charge target')}
              value={targetSoc}
              min={50}
              max={100}
              onChange={setTargetSoc}
              formatValue={(v) => `${v}%`}
            />
            <Button
              onClick={handleSave}
              disabled={!vehicleId || saveMutation.isPending}
              loading={saveMutation.isPending}
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
