import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'

import { PageLayout, Section } from '@/components/layout/layout-reference'
import { GlassPanel } from '@/components/ui'
import { DataProvenanceBadge } from '@/components/data-display'
import { LiveStaleDataBanner, SectionErrorBoundary, EmptyState, QueryError, StaleRefreshWarning, useToast } from '@/components/feedback'
import { FadeIn } from '@/components/motion'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useDataState } from '@/hooks/useDataState'
import { request } from '@/api/client'
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

import { deriveStatus, type StateResponse } from '../components/vehicle-detail/helpers'
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
import { AIVehiclePaintPreview } from '@/components/ai/AIVehiclePaintPreview'

export default function VehicleDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  // Guard the deep-link id: a non-numeric/zero/negative id previously flowed
  // into every query as NaN (silently disabled) and rendered an empty page
  // shell. Clamp to 0 (which every `enabled`/`> 0` gate already treats as
  // absent) and render an explicit not-found branch below instead.
  const rawId = Number(id)
  const hasValidId = Number.isFinite(rawId) && rawId > 0
  const vehicleId = hasValidId ? rawId : 0
  usePageTitle(t('vehicles.detail.title', 'Vehicle detail'))

  /* ─── Queries ─── */

  const vehicleQuery = useQuery({
    queryKey: ['vehicles', String(vehicleId)],
    queryFn: () => request<Vehicle>(`/vehicles/${vehicleId}`),
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
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => request<StateResponse>(`/vehicles/${vehicleId}/state`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })
  const { data: stateData, refetch: refetchState } = stateQuery
  const stateDataState = useDataState(stateQuery, { provenance: 'live' })

  const motorQuery = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: () => request<MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const climateQuery = useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: () => request<ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const securityQuery = useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: () => request<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const tireQuery = useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: () => request<TirePressureSnapshot | null>(`/tire-pressure/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })

  const chargingTelemetryQuery = useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: () => request<ChargingTelemetry | null>(`/charging-telemetry/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 5_000,
  })

  const drivesQuery = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${vehicleId}&limit=5`),
    enabled: vehicleId > 0,
  })
  const { data: drives } = drivesQuery

  const sessionsQuery = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${vehicleId}&limit=5`),
    enabled: vehicleId > 0,
  })

  const vehicleConfigQuery = useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: () => request<VehicleConfigSnapshot | null>(`/vehicle-config/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })
  const { data: vehicleConfig } = vehicleConfigQuery

  const toast = useToast()
  const wakeMutation = useMutation({
    mutationFn: () => request<{ status: string }>(`/vehicles/${vehicleId}/wake`, { method: 'POST' }),
    onSuccess: () => {
      toast.success(t('vehicles.detail.wakeSuccess', 'Wake command sent'))
      setTimeout(() => { refetchState() }, 5000)
    },
    onError: (err: Error) => {
      toast.error(err.message || t('vehicles.detail.wakeFailed', 'Failed to wake vehicle'))
    },
  })

  /* ─── Derived state ─── */

  const state = stateData?.state
  // Independent live state remains useful when the vehicle-record read
  // fails. Keep the existing status derivation, not a fabricated record.
  const status: VehicleStatus = vehicle || state ? deriveStatus(state) : 'offline'

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
        <div className="flex flex-wrap items-center gap-2">
          <DataProvenanceBadge
            provenance={stateDataState.provenance}
            status={stateDataState.status}
            updatedAt={stateDataState.updatedAt}
          />
        </div>
      }
      contextActions={
        <SectionErrorBoundary name="vehicle-detail:header" fallbackTitle={t('vehicles.detail.section.headerFailed', 'Vehicle header failed to load')}>
          <FadeIn>
            <div data-tour="vehicle-detail-tabs">
              <VehicleHeader
                vehicle={vehicle}
                status={status}
                onWake={() => wakeMutation.mutate()}
                waking={wakeMutation.isPending}
              />
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
      <VehicleDetailSystems state={state} motorQuery={motorQuery} climateQuery={climateQuery}
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
