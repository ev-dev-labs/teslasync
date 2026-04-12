import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { PageContainer } from '@/components/layout/PageContainer'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSettings } from '@/hooks/useSettings'
import { useVehicleLive } from '@/hooks/useVehicleLive'
import { useAdaptiveInterval } from '@/hooks/useAdaptiveInterval'
import {
  useVehicle,
  useVehicleState,
  useVehiclePositions,
  useMotorLatest,
  useClimateLatest,
  useSecurityLatest,
  useLatestTirePressure,
  useChargingTelemetryLatest,
  useMediaLatest,
  useLocationSnapshotLatest,
  useVehicleConfigLatest,
  useUserPreferenceLatest,
} from '@/api/hooks/useVehicles'
import { getDrives } from '@/api/hooks/useDriving'
import { getChargingSessions } from '@/api/hooks/useCharging'
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

  const { data: vehicle, error: vehicleError } = useVehicle(String(vehicleId))

  const {
    data: stateData,
    refetch: refetchState,
    error: stateError,
  } = useVehicleState(vehicleId)

  const { data: positions, error: positionsError } = useVehiclePositions(vehicleId, 200)

  const { data: drives, error: drivesError } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => getDrives(vehicleId, 5),
  })

  const { data: sessions, error: sessionsError } = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () => getChargingSessions(vehicleId, 5),
  })

  /* ─── Telemetry queries (adaptive interval) ─── */

  const { data: motorData, error: motorError } = useMotorLatest(vehicleId, pollInterval)

  const { data: climateData, error: climateError } = useClimateLatest(vehicleId, pollInterval)

  const { data: securityData, error: securityError } = useSecurityLatest(vehicleId, pollInterval)

  const { data: tireData, error: tireError } = useLatestTirePressure(vehicleId, pollInterval)

  const { data: chargingTelemetry, error: chargingTelemetryError } = useChargingTelemetryLatest(vehicleId, 5000)

  const { data: mediaData, error: mediaError } = useMediaLatest(vehicleId, 5000)

  const { data: locationData, error: locationError } = useLocationSnapshotLatest(vehicleId, 5000)

  const { data: vehicleConfigData, error: vehicleConfigError } = useVehicleConfigLatest(vehicleId, 30000)

  const { data: userPrefData, error: userPrefError } = useUserPreferenceLatest(vehicleId, 30000)

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
    <PageContainer
      title={vehicle?.display_name ?? t('vehicles.detail.title', 'Vehicle Detail')}
      loading={!vehicle && !vehicleError}
      error={vehicleError as Error | null}
    >
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
    </PageContainer>
  )
}
