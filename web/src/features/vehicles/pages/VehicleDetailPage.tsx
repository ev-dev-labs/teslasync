import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSettings } from '@/hooks/useSettings'
import { useVehicleLive } from '@/hooks/useVehicleLive'
import { useAdaptiveInterval } from '@/hooks/useAdaptiveInterval'
import {
  getVehicle,
  getVehicleState,
  getVehiclePositions,
  getMotorLatest,
  getClimateLatest,
  getSecurityLatest,
  getLatestTirePressure,
  getChargingTelemetryLatest,
  getMediaLatest,
  getLocationSnapshotLatest,
  getVehicleConfigLatest,
  getUserPreferenceLatest,
} from '@/api/vehicles'
import { getDrives } from '@/api/drives'
import { getChargingSessions } from '@/api/charging'
import { VehicleHeader } from '../components/VehicleHeader'
import { VehicleGauges } from '../components/VehicleGauges'
import { TelemetryGrid, LiveTelemetryPanels } from '../components/TelemetryPanels'
import { VehicleCharts } from '../components/VehicleCharts'
import { RecentActivity } from '../components/RecentActivity'

export default function VehicleDetailPage() {
  usePageTitle('Vehicle Detail')
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const vehicleId = Number(id)
  useSettings() // ensure global precision is set

  // SSE live state for real-time vehicle signals
  const { state: live, connected: sseConnected } = useVehicleLive(vehicleId)
  const pollInterval = useAdaptiveInterval()

  /* ─── Core queries ─── */

  const { data: vehicle, error: vehicleError } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => getVehicle(vehicleId),
  })

  const {
    data: stateData,
    refetch: refetchState,
    error: stateError,
  } = useQuery({
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => getVehicleState(vehicleId),
    refetchInterval: 30_000,
  })

  const { data: positions, error: positionsError } = useQuery({
    queryKey: ['vehicle-positions', vehicleId],
    queryFn: () => getVehiclePositions(vehicleId, 200),
  })

  const { data: drives, error: drivesError } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => getDrives(vehicleId, 5),
  })

  const { data: sessions, error: sessionsError } = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () => getChargingSessions(vehicleId, 5),
  })

  /* ─── Telemetry queries (adaptive interval) ─── */

  const { data: motorData, error: motorError } = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: () => getMotorLatest(vehicleId),
    refetchInterval: pollInterval,
  })

  const { data: climateData, error: climateError } = useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: () => getClimateLatest(vehicleId),
    refetchInterval: pollInterval,
  })

  const { data: securityData, error: securityError } = useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: () => getSecurityLatest(vehicleId),
    refetchInterval: pollInterval,
  })

  const { data: tireData, error: tireError } = useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: () => getLatestTirePressure(vehicleId),
    refetchInterval: pollInterval,
  })

  const { data: chargingTelemetry, error: chargingTelemetryError } = useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: () => getChargingTelemetryLatest(vehicleId),
    refetchInterval: 5000,
  })

  const { data: mediaData, error: mediaError } = useQuery({
    queryKey: ['media-latest', vehicleId],
    queryFn: () => getMediaLatest(vehicleId),
    refetchInterval: 5000,
  })

  const { data: locationData, error: locationError } = useQuery({
    queryKey: ['location-latest', vehicleId],
    queryFn: () => getLocationSnapshotLatest(vehicleId),
    refetchInterval: 5000,
  })

  const { data: vehicleConfigData, error: vehicleConfigError } = useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: () => getVehicleConfigLatest(vehicleId),
    refetchInterval: 30000,
  })

  const { data: userPrefData, error: userPrefError } = useQuery({
    queryKey: ['user-pref-latest', vehicleId],
    queryFn: () => getUserPreferenceLatest(vehicleId),
    refetchInterval: 30000,
  })

  /* ─── Derived state ─── */

  const anyError =
    vehicleError ||
    stateError ||
    positionsError ||
    drivesError ||
    sessionsError ||
    motorError ||
    climateError ||
    securityError ||
    tireError ||
    chargingTelemetryError ||
    mediaError ||
    locationError ||
    vehicleConfigError ||
    userPrefError

  const state = stateData?.state

  return (
    <div className="space-y-6">
      {/* Header: Back button, name, badges, wake action */}
      <VehicleHeader
        vehicle={vehicle}
        state={state}
        onRefetchState={() => refetchState()}
      />

      {/* Global error banner */}
      {anyError && (
        <div className="p-4 rounded-lg border border-neon-red/30 bg-neon-red/5 text-neon-red text-sm">
          {t('common.loadError', 'Failed to load data')}: {(anyError as Error).message}
        </div>
      )}

      {state ? (
        <>
          {/* Hero: Car Viz + Gauges */}
          <VehicleGauges vehicle={vehicle!} state={state} />

          {/* Quick stat tiles */}
          <TelemetryGrid state={state} />

          {/* Live Telemetry Panels (7 panels) */}
          <LiveTelemetryPanels
            motorData={motorData}
            climateData={climateData}
            securityData={securityData}
            tireData={tireData}
            chargingTelemetry={chargingTelemetry}
            mediaData={mediaData}
            locationData={locationData}
            live={live as unknown as Record<string, unknown>}
            sseConnected={sseConnected}
          />

          {/* Map + Charts + Config */}
          <VehicleCharts
            state={state}
            positions={positions}
            vehicleConfigData={vehicleConfigData}
            userPrefData={userPrefData}
          />

          {/* Recent Drives & Charging Sessions */}
          <RecentActivity drives={drives} sessions={sessions} />
        </>
      ) : (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      )}
    </div>
  )
}
