import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDataState } from '@/hooks/useDataState';
import { isVehicleStateFieldCurrent, useVehicleState } from '@/api/hooks/useVehicles';
import { useGeofences } from '@/api/hooks/useLocations';
import {
  useGuardConfig, useGuardEvents, useSetGuardConfig, useGuardPanic,
  useAcknowledgeGuardEvent, isGuardEventAcknowledged,
} from '@/api/hooks/useGuard';

/** The original queries, drafts and command payloads. Presenters never fetch or
 * execute commands except through these explicit user-action callbacks. */
export function useGuardPageModel() {
  const { t } = useTranslation();
  const { vehicleId, vehicle: activeVehicle } = useSelectedVehicle();
  const activeVehicleId = vehicleId ?? 0;
  const configQuery = useGuardConfig(activeVehicleId);
  const eventsQuery = useGuardEvents(activeVehicleId);
  const guardConfig = configQuery.data;
  const vehicleStateQuery = useVehicleState(activeVehicleId, {
    refetchInterval: guardConfig?.enabled ? 5_000 : 30_000,
  });
  const geofencesQuery = useGeofences();
  const geofences = geofencesQuery.data;
  const setConfig = useSetGuardConfig();
  const panic = useGuardPanic();
  const ackEvent = useAcknowledgeGuardEvent();
  const configState = useDataState(configQuery);
  const eventsState = useDataState(eventsQuery, { provenance: 'historical' });
  const vehicleState = useDataState(vehicleStateQuery, { provenance: 'live' });
  const geofencesState = useDataState(geofencesQuery);

  const [panicDialogOpen, setPanicDialogOpen] = useState(false);
  const [sensitivity, setSensitivity] = useState<string>('');
  // null follows persistence; '' is the user's explicit "no home geofence".
  const [homeGeofenceId, setHomeGeofenceId] = useState<string | null>(null);
  // Untouched follows persistence; explicit false must not reset to saved true.
  const [autoPanic, setAutoPanic] = useState<boolean | null>(null);
  const effectiveSensitivity = sensitivity || guardConfig?.sensitivity || 'medium';
  const effectiveHomeGeofenceId =
    homeGeofenceId ?? (guardConfig?.home_geofence_id != null ? String(guardConfig.home_geofence_id) : '');
  const effectiveAutoPanic = autoPanic ?? guardConfig?.auto_panic ?? false;
  // Preserve command defaults, but never present these defaults as observations.
  const isArmed = guardConfig?.enabled ?? false;
  const policyEnabled = guardConfig?.enabled ?? null;
  const events = eventsQuery.data ?? [];
  const eventsKnown = eventsQuery.data != null;
  const unacknowledgedCount = events.filter(e => !isGuardEventAcknowledged(e)).length;
  const latestEvent = events[0] ?? null;
  const isTriggered = latestEvent != null &&
    !isGuardEventAcknowledged(latestEvent) && latestEvent.event_type !== 'test_alert';
  const stateResponse = vehicleStateQuery.data;
  const state = stateResponse?.state;
  const vehicleLat = state?.latitude;
  const vehicleLng = state?.longitude;
  const hasLocation =
    isVehicleStateFieldCurrent(stateResponse, 'latitude') &&
    isVehicleStateFieldCurrent(stateResponse, 'longitude') &&
    typeof vehicleLat === 'number' && Number.isFinite(vehicleLat) &&
    vehicleLat >= -90 && vehicleLat <= 90 &&
    typeof vehicleLng === 'number' && Number.isFinite(vehicleLng) &&
    vehicleLng >= -180 && vehicleLng <= 180;
  const lockKnown = isVehicleStateFieldCurrent(stateResponse, 'is_locked');
  const sentryKnown = isVehicleStateFieldCurrent(stateResponse, 'sentry_mode');
  const isLocked = lockKnown && state?.is_locked != null ? Boolean(state.is_locked) : null;
  const sentryOn = sentryKnown && state?.sentry_mode != null ? Boolean(state.sentry_mode) : null;
  const homeGeofence = geofences?.find(g => String(g.id) === effectiveHomeGeofenceId) ?? null;
  const geofenceOptions = useMemo(() => [
    { value: '', label: t('guard.noGeofence', '— No home geofence —') },
    ...(geofences ?? []).map(g => ({ value: String(g.id), label: g.name })),
  ], [geofences, t]);
  const sensitivityOptions = useMemo(() => [
    { value: 'low', label: t('guard.sensitivityLowFull', 'Low — movement > 1 km') },
    { value: 'medium', label: t('guard.sensitivityMediumFull', 'Medium — movement > 200 m') },
    { value: 'high', label: t('guard.sensitivityHighFull', 'High — any movement') },
  ], [t]);
  const sensitivityLabel = effectiveSensitivity === 'low'
    ? t('guard.sensitivityLow', 'Low')
    : effectiveSensitivity === 'high'
      ? t('guard.sensitivityHigh', 'High')
      : t('guard.sensitivityMedium', 'Medium');
  const policyLabel = policyEnabled == null
    ? t('guard.modernization.policyUnknown', 'Saved policy unavailable')
    : policyEnabled ? t('guard.armed', 'Armed') : t('guard.disarmed', 'Disarmed');

  const handleToggleGuard = () => {
    if (activeVehicleId <= 0) return;
    setConfig.mutate({
      vehicleId: activeVehicleId,
      enabled: !isArmed,
      home_geofence_id: effectiveHomeGeofenceId ? Number(effectiveHomeGeofenceId) : null,
      sensitivity: effectiveSensitivity,
      auto_panic: effectiveAutoPanic,
    });
  };
  const handleSaveSettings = () => {
    if (activeVehicleId <= 0) return;
    setConfig.mutate({
      vehicleId: activeVehicleId,
      enabled: isArmed,
      home_geofence_id: effectiveHomeGeofenceId ? Number(effectiveHomeGeofenceId) : null,
      sensitivity: effectiveSensitivity,
      auto_panic: effectiveAutoPanic,
    });
  };
  const handlePanic = () => {
    setPanicDialogOpen(false);
    if (activeVehicleId > 0) panic.mutate(activeVehicleId);
  };
  const handleAcknowledge = (eventId: number) => {
    if (activeVehicleId > 0) ackEvent.mutate({ vehicleId: activeVehicleId, eventId });
  };

  return {
    activeVehicle, activeVehicleId, noVehicle: activeVehicleId <= 0,
    configQuery, eventsQuery, vehicleStateQuery, geofencesQuery,
    configState, eventsState, vehicleState, geofencesState,
    guardConfig, events, eventsKnown, unacknowledgedCount, latestEvent, isTriggered,
    policyEnabled, policyLabel, isArmed, stateResponse, hasLocation, vehicleLat, vehicleLng,
    isLocked, sentryOn, homeGeofence, geofenceOptions, sensitivityOptions,
    effectiveSensitivity, effectiveHomeGeofenceId, effectiveAutoPanic, sensitivityLabel,
    setSensitivity, setHomeGeofenceId, setAutoPanic,
    setConfig, panic, ackEvent, panicDialogOpen, setPanicDialogOpen,
    handleToggleGuard, handleSaveSettings, handlePanic, handleAcknowledge,
  };
}

export type GuardPageModel = ReturnType<typeof useGuardPageModel>;
