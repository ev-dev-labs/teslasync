import { useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'

import { PageLayout, Section } from '@/components/layout'
import { Caption, GlassPanel } from '@/components/ui'
import { DataProvenanceBadge } from '@/components/data-display'
import { LiveStaleDataBanner, SectionErrorBoundary, EmptyState, QueryError, StaleRefreshWarning, useToast } from '@/components/feedback'
import { FadeIn } from '@/components/motion'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useDataState } from '@/hooks/useDataState'
import { useOperationalMode } from '@/hooks/useOperationalMode'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useTelemetryClock } from '@/hooks/useTelemetryFreshness'
import { formatObservationAge } from '@/lib/observationAge'
import { getVehicleStateEvidence, vehicleKeys, type RawStateResponse } from '@/api/hooks/useVehicles'
import { request } from '@/api/client'
import { VEHICLE_STATUSES } from '@/api/types'
import type {
  Vehicle,
  VehicleStatus,
  MotorSnapshot,
  ClimateSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  ChargingTelemetry,
  Drive,
  ChargingSession,
  VehicleConfigSnapshot,
} from '@/api/types'

import { deriveStatus } from '../components/vehicle-detail/helpers'
import {
  VehicleHeader,
  VehicleConfigSection,
  QuickLinksSection,
} from '../components/vehicle-detail'
import {
  VehiclePanelGrid, VehicleSourcePanel, VehicleDetailCharts, VehicleDetailOverview,
  VehicleDetailSystems, VehicleDetailSkeleton, VehicleDetailHistory, VehicleDetailStats,
} from '../components/modernization'
import VehicleSettingsTab from '../components/VehicleSettingsTab'
import { SilenceBanner } from '../components/SilenceBanner'
import { NextChargeDecisionStrip } from '../components/NextChargeDecisionStrip'
import { useVehicleSettings, findEffectiveSetting } from '@/api/hooks/useVehicleSettings'
import { AIVehiclePaintPreview } from '@/components/ai'

export default function VehicleDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const rawId = Number(id)
  const hasValidId = Number.isSafeInteger(rawId) && rawId > 0
  const vehicleId = hasValidId ? rawId : 0
  usePageTitle(t('vehicles.detail.title', 'Vehicle detail'))

  /* ─── Queries ─── */

  const vehicleQuery = useQuery({
    queryKey: ['vehicles', String(vehicleId)],
    queryFn: ({ signal }) => request<Vehicle>(`/vehicles/${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
  })
  const { data: vehicle, isLoading: vehicleLoading } = vehicleQuery
  const vehicleDataState = useDataState(vehicleQuery)

  // Nickname override feeds the page title and breadcrumb; falls back to
  // vehicles.display_name when no override is present.
  const { data: vehicleSettings } = useVehicleSettings(vehicleId)
  const nicknameSetting = findEffectiveSetting(vehicleSettings, 'nickname')
  const effectiveName =
    typeof nicknameSetting?.value === 'string' && nicknameSetting.value !== ''
      ? nicknameSetting.value
      : vehicle?.display_name

  const stateQuery = useQuery({
    queryKey: vehicleKeys.state(vehicleId),
    queryFn: ({ signal }) => request<RawStateResponse | null>(`/vehicles/${vehicleId}/state`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })
  const { data: stateData, refetch: refetchState } = stateQuery
  useTelemetryClock()
  const stateEvidence = getVehicleStateEvidence(stateData)
  const stateDataState = useDataState(stateQuery, {
    provenance: stateData?.live === true ? 'live' : 'unknown',
    partial: stateEvidence.freshness === 'unknown' || stateEvidence.verifiedFields.length === 0,
  })
  const stateTrustStatus = (stateDataState.status === 'ok' || stateDataState.status === 'partial') && stateEvidence.freshness === 'stale'
    ? 'stale'
    : stateDataState.status
  const observationAge = formatObservationAge(stateEvidence.observedAt, t)

  const motorQuery = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: ({ signal }) => request<MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const climateQuery = useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: ({ signal }) => request<ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const securityQuery = useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: ({ signal }) => request<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const tireQuery = useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: ({ signal }) => request<TirePressureSnapshot | null>(`/tire-pressure/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })

  const chargingTelemetryQuery = useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: ({ signal }) => request<ChargingTelemetry | null>(`/charging-telemetry/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval: 5_000,
  })

  const drivesQuery = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: ({ signal }) => request<Drive[]>(`/drives?vehicle_id=${vehicleId}&limit=5`, { signal }),
    enabled: vehicleId > 0,
  })
  const { data: drives } = drivesQuery

  const sessionsQuery = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: ({ signal }) => request<ChargingSession[]>(`/charging?vehicle_id=${vehicleId}&limit=5`, { signal }),
    enabled: vehicleId > 0,
  })

  const vehicleConfigQuery = useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: ({ signal }) => request<VehicleConfigSnapshot | null>(`/vehicle-config/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })
  const { data: vehicleConfig } = vehicleConfigQuery

  const toast = useToast()
  const operationalMode = useOperationalMode()
  const online = useOnlineStatus()
  const wakeInFlight = useRef(false)
  const wakeBlockReason = !operationalMode.canWrite
    ? operationalMode.writeBlockReason ?? t('operationalMode.writeBlocked', 'Return to live mode before making operational changes.')
    : !online
      ? t('operationalMode.cached.writeBlocked', 'Reconnect before making operational changes.')
      : null
  const wakeMutation = useMutation({
    networkMode: 'always',
    mutationFn: () => {
      if (wakeBlockReason) throw new Error(wakeBlockReason)
      return request<{ status: string }>(`/vehicles/${vehicleId}/wake`, { method: 'POST' })
    },
    onSuccess: () => {
      toast.success(t('vehicles.detail.wakeSuccess', 'Wake command sent'))
      setTimeout(() => { refetchState() }, 5000)
    },
    onError: (err: Error) => {
      toast.error(err.message || t('vehicles.detail.wakeFailed', 'Failed to wake vehicle'))
    },
    onSettled: () => { wakeInFlight.current = false },
  })
  const handleWake = () => {
    if (wakeInFlight.current || wakeMutation.isPending) return
    if (wakeBlockReason) {
      toast.error(wakeBlockReason)
      return
    }
    wakeInFlight.current = true
    wakeMutation.mutate()
  }

  /* ─── Derived state ─── */

  const state = stateData?.state
  // A partial state object must not mask a known vehicle-record status.
  const stateHasStatus = state != null && (
    state.is_charging === true ||
    (typeof state.speed === 'number' && Number.isFinite(state.speed) && state.speed > 0) ||
    VEHICLE_STATUSES.some(status => status === state.state?.toLowerCase())
  )
  const status: VehicleStatus = deriveStatus(stateHasStatus ? state : vehicle)

  // Model + trim badge shown under the (nickname) title for quick identification.
  const subtitle = vehicle
    ? [vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ') || undefined
    : undefined

  /* ─── Loading short-circuit ─────────── */
  if (vehicleLoading) {
    return (
      <PageLayout title={t('vehicles.detail.title', 'Vehicle detail')} busy>
        <VehicleDetailSkeleton />
      </PageLayout>
    )
  }

  if (!hasValidId) {
    return (
      <PageLayout title={t('vehicles.detail.title', 'Vehicle detail')}>
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState
              icon={<AlertCircle className="h-8 w-8" aria-hidden="true" />}
              title={t('vehicles.detail.invalidIdTitle', 'Vehicle not found')}
              message={t('vehicles.detail.invalidIdBody', 'That vehicle link looks wrong. Check the URL or pick a vehicle from the list.')}
              actionTo={{ label: t('vehicles.detail.backToVehicles', 'Back to vehicles'), to: '/vehicles' }}
            />
          </GlassPanel>
        </FadeIn>
      </PageLayout>
    )
  }

  /* ─── Render ─── */

  return (
    <PageLayout
      title={effectiveName ?? t('vehicles.detail.title', 'Vehicle detail')}
      subtitle={subtitle}
      breadcrumbLabels={{
        '/vehicles/:id': effectiveName ?? t('vehicles.detail.vehicleNumber', 'Vehicle #{{id}}', { id }),
      }}
      metadataActions={
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <DataProvenanceBadge
            provenance={stateDataState.provenance}
            status={stateTrustStatus}
          />
          <Caption className="min-w-0 break-words" title={stateData?.observed_at ?? undefined}>
            {observationAge
              ? t('dashboard.fleetPosture.scope.observed', 'Last real observation {{age}}', { age: observationAge })
              : t('dashboard.fleetPosture.scope.noObservation', 'No verified observation time for this vehicle')}
          </Caption>
        </div>
      }
      contextActions={
        <SectionErrorBoundary name="vehicle-detail:header" fallbackTitle={t('vehicles.detail.section.headerFailed', 'Vehicle header failed to load')}>
          <FadeIn>
            <div className="min-w-0 max-w-full" data-tour="vehicle-detail-tabs">
              <fieldset
                disabled={wakeBlockReason != null || wakeMutation.isPending}
                aria-describedby={wakeBlockReason ? 'vehicle-wake-blocked' : undefined}
                className="m-0 min-w-0 border-0 p-0"
              >
                <VehicleHeader
                  vehicle={vehicle}
                  status={status}
                  onWake={handleWake}
                  waking={wakeMutation.isPending}
                />
              </fieldset>
              {wakeBlockReason && <Caption className="break-words" id="vehicle-wake-blocked">{wakeBlockReason}</Caption>}
            </div>
          </FadeIn>
        </SectionErrorBoundary>
      }
    >
      <LiveStaleDataBanner />
      {vehicleDataState.fatalError != null && (
        <GlassPanel padding="md">
          <QueryError error={vehicleDataState.fatalError}
            onRetry={() => { vehicleQuery.refetch() }}
            resourceName={t('vehicles.detail.title', 'Vehicle detail')} />
        </GlassPanel>
      )}
      <StaleRefreshWarning state={vehicleDataState} label={t('vehicles.detail.title', 'Vehicle detail')} />
      <SilenceBanner vehicleId={vehicleId > 0 ? vehicleId : undefined} />
      <NextChargeDecisionStrip
        vehicleId={vehicleId > 0 ? vehicleId : undefined}
        currentSoc={typeof state?.battery_level === 'number' ? state.battery_level : undefined}
      />

      <VehicleDetailOverview state={state} stateQuery={stateQuery} />
      <VehicleDetailStats state={state} status={status} stateQuery={stateQuery} />
      <VehicleDetailSystems state={state} stateQuery={stateQuery} motorQuery={motorQuery} climateQuery={climateQuery}
        securityQuery={securityQuery} tireQuery={tireQuery} chargingTelemetryQuery={chargingTelemetryQuery} />

      {/* Battery & range charts — existing source order, shared host sizing. */}
      <FadeIn delay={0.12}>
        <Section id="vehicle-battery-charts" title={t('vehicles.detail.batteryRange', 'Battery & range')}>
          <SectionErrorBoundary name="vehicle-detail:battery-charts" fallbackTitle={t('vehicles.detail.section.batteryChartsFailed', 'Battery & range charts failed to load')}>
            <VehicleDetailCharts state={state} drives={drives} stateQuery={stateQuery} drivesQuery={drivesQuery} />
          </SectionErrorBoundary>
        </Section>
      </FadeIn>

      <VehicleDetailHistory drivesQuery={drivesQuery} sessionsQuery={sessionsQuery} />

      {/* Configuration and the independently gated Helix preview stay in
          source order. A hidden AI feature creates no empty grid cell. */}
      <FadeIn delay={0.16}>
        <Section id="vehicle-configuration" title={t('vehicles.detail.vehicleConfig', 'Vehicle configuration')}>
          <VehiclePanelGrid label={t('vehicles.detail.vehicleConfig', 'Vehicle configuration')} items={[
            { id: 'vehicle-configuration', size: 'full', content:
              <SectionErrorBoundary name="vehicle-detail:vehicle-config" fallbackTitle={t('vehicles.detail.section.vehicleConfigFailed', 'Vehicle config section failed to load')}>
                <VehicleSourcePanel query={vehicleConfigQuery}
                  label={t('vehicles.detail.vehicleConfig', 'Vehicle configuration')}
                  emptyMessage={t('vehicles.detail.noVehicleConfig', 'No configuration data available')}
                  errorMessage={t('vehicles.detail.section.vehicleConfigFailed', 'Vehicle config section failed to load')}>
                  <VehicleConfigSection vehicleConfig={vehicleConfig} softwareVersion={state?.software_version} />
                </VehicleSourcePanel>
              </SectionErrorBoundary>
            },
          ]} />
          <SectionErrorBoundary name="vehicle-detail:ai-paint-preview" fallbackTitle={t('vehicles.detail.section.aiPaintPreviewFailed', 'Helix paint preview failed to load')}>
            <AIVehiclePaintPreview vehicleId={vehicleId} />
          </SectionErrorBoundary>
        </Section>
      </FadeIn>

      {/* Quick links — full-width */}
      <FadeIn delay={0.18}>
        <SectionErrorBoundary name="vehicle-detail:quick-links" fallbackTitle={t('vehicles.detail.section.quickLinksFailed', 'Quick links failed to load')}>
          <QuickLinksSection />
        </SectionErrorBoundary>
      </FadeIn>

      {/* Per-vehicle settings — full-width */}
      <FadeIn delay={0.20}>
        <SectionErrorBoundary
          name="vehicle-detail:settings"
          fallbackTitle={t('vehicles.detail.section.settingsFailed', 'Per-vehicle settings failed to load')}
        >
          <VehicleSettingsTab vehicleId={vehicleId} />
        </SectionErrorBoundary>
      </FadeIn>
    </PageLayout>
  )
}
