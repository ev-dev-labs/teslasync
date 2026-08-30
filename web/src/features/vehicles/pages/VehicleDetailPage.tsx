import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Activity } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, PanelTitle, SectionTitle } from '@/components/ui'
import { DataProvenanceBadge, LiveIndicator } from '@/components/data-display'
import { Skeleton, LiveStaleDataBanner, SectionErrorBoundary, StatGridSkeleton, ChartBlockSkeleton, PageHeaderSkeleton, QueryError } from '@/components/feedback'
import { FadeIn } from '@/components/motion'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useDataState } from '@/hooks/useDataState'
import { useToast } from '@/components/feedback/Toast'
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
  BatteryRangePanel,
  LiveStateIndicators,
  QuickStatsGrid,
  MotorSection,
  ClimateSection,
  SecuritySection,
  TirePressureSection,
  ChargingTelemetrySection,
  BatteryRangeCharts,
  RecentDrivesSection,
  RecentChargesSection,
  VehicleConfigSection,
  QuickLinksSection,
} from '../components/vehicle-detail'
import VehicleSettingsTab from '../components/VehicleSettingsTab'
import { useVehicleSettings, findEffectiveSetting } from '@/api/hooks/useVehicleSettings'
import { AIVehiclePaintPreview } from '@/components/ai/AIVehiclePaintPreview'

/* ─── Loading skeleton ─────────────────────── */

/**
 * Mirrors the VehicleDetailPage layout while the vehicle record loads:
 * page header → battery & range panel → live state indicators →
 * 4-card quick-stats grid → motor/climate/security/tire panels →
 * battery-range chart → recent drives + charges tables → quick links.
 */
function VehicleDetailSkeleton() {
  return (
    <div className="space-y-6" data-testid="vehicle-detail-skeleton">
      <PageHeaderSkeleton />
      <Skeleton className="h-40 rounded-xl" />
      <StatGridSkeleton cards={4} />
      <StatGridSkeleton cards={4} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
      <ChartBlockSkeleton height={320} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <StatGridSkeleton cards={6} className="md:grid-cols-3 lg:grid-cols-6" />
    </div>
  )
}

export default function VehicleDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const vehicleId = Number(id)
  usePageTitle(t('vehicles.detail.title', 'Vehicle Detail'))

  /* ─── Queries ─── */

  const { data: vehicle, isLoading: vehicleLoading, error: vehicleError } = useQuery({
    queryKey: ['vehicles', String(vehicleId)],
    queryFn: () => request<Vehicle>(`/vehicles/${vehicleId}`),
    enabled: vehicleId > 0,
  })

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
  const { data: stateData, error: stateError, refetch: refetchState } = stateQuery
  const stateDataState = useDataState(stateQuery, { provenance: 'live' })

  const { data: motorData } = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: () => request<MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const { data: climateData } = useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: () => request<ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const { data: securityData } = useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: () => request<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  })

  const { data: tireData } = useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: () => request<TirePressureSnapshot | null>(`/tire-pressure/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })

  const { data: chargingTelemetry } = useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: () => request<ChargingTelemetry | null>(`/charging-telemetry/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 5_000,
  })

  const { data: drives } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${vehicleId}&limit=5`),
    enabled: vehicleId > 0,
  })

  const { data: sessions } = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${vehicleId}&limit=5`),
    enabled: vehicleId > 0,
  })

  const { data: vehicleConfig } = useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: () => request<VehicleConfigSnapshot | null>(`/vehicle-config/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })

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
  const status: VehicleStatus = vehicle ? deriveStatus(state) : 'offline'

  // Model + trim badge shown under the (nickname) title for quick identification.
  const subtitle = vehicle
    ? [vehicle.model, vehicle.trim_badging].filter(Boolean).join(' ') || undefined
    : undefined

  /* ─── Loading short-circuit ─────────── */
  if (vehicleLoading) {
    return <VehicleDetailSkeleton />
  }

  /* ─── Render ─── */

  return (
    <PageContainer
      title={effectiveName ?? t('vehicles.detail.title', 'Vehicle Detail')}
      subtitle={subtitle}
      error={vehicleError as Error | null}
      breadcrumbLabels={{
        '/vehicles/:id': effectiveName ?? t('vehicles.detail.vehicleNumber', 'Vehicle #{{id}}', { id }),
      }}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <DataProvenanceBadge
            provenance={stateDataState.provenance}
            status={stateDataState.status}
            updatedAt={stateDataState.updatedAt}
          />
          <LiveIndicator variant="compact" />
        </div>
      }
    >
      <LiveStaleDataBanner />

      {/* Hero header — full-width band */}
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

      {!state ? (
        <FadeIn delay={0.05}>
          <GlassPanel className="p-8">
            {stateError ? (
              <QueryError
                error={stateError}
                onRetry={() => { refetchState() }}
                resourceName={t('vehicles.detail.liveStateResource', 'Live vehicle state')}
              />
            ) : (
              <Skeleton lines={5} height={20} />
            )}
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* Live overview — battery hero spans 2 cols, live-state side panel fills the third */}
          <FadeIn delay={0.03}>
            <section className="space-y-4">
              <SectionTitle>{t('vehicles.detail.overview', 'Live Overview')}</SectionTitle>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="xl:col-span-2">
                  <SectionErrorBoundary name="vehicle-detail:battery-range" fallbackTitle={t('vehicles.detail.section.batteryRangeFailed', 'Battery & range section failed to load')}>
                    <BatteryRangePanel state={state} />
                  </SectionErrorBoundary>
                </div>
                <SectionErrorBoundary name="vehicle-detail:live-state" fallbackTitle={t('vehicles.detail.section.liveStateFailed', 'Live state indicators failed to load')}>
                  <GlassPanel className="h-full p-6">
                    <PanelTitle className="mb-4 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                      {t('vehicles.detail.liveState', 'Live State')}
                    </PanelTitle>
                    <LiveStateIndicators state={state} />
                  </GlassPanel>
                </SectionErrorBoundary>
              </div>
            </section>
          </FadeIn>

          {/* Quick stats — full-width KPI band */}
          <FadeIn delay={0.08}>
            <section className="space-y-3" aria-label={t('vehicles.detail.quickStats', 'Quick Stats')}>
              <SectionTitle>{t('vehicles.detail.quickStats', 'Quick Stats')}</SectionTitle>
              <SectionErrorBoundary name="vehicle-detail:quick-stats" fallbackTitle={t('vehicles.detail.section.quickStatsFailed', 'Quick stats failed to load')}>
                <QuickStatsGrid state={state} status={status} />
              </SectionErrorBoundary>
            </section>
          </FadeIn>

          {/* Vehicle systems — telemetry bento: paired panels on wide screens */}
          <FadeIn delay={0.10}>
            <section className="space-y-4">
              <SectionTitle>{t('vehicles.detail.systems', 'Vehicle Systems')}</SectionTitle>
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <SectionErrorBoundary name="vehicle-detail:motor" fallbackTitle={t('vehicles.detail.section.motorFailed', 'Motor section failed to load')}>
                  <MotorSection motorData={motorData} />
                </SectionErrorBoundary>
                <SectionErrorBoundary name="vehicle-detail:climate" fallbackTitle={t('vehicles.detail.section.climateFailed', 'Climate section failed to load')}>
                  <ClimateSection climateData={climateData} />
                </SectionErrorBoundary>
              </div>
              <SectionErrorBoundary name="vehicle-detail:charging-telemetry" fallbackTitle={t('vehicles.detail.section.chargingTelemetryFailed', 'Charging telemetry failed to load')}>
                <ChargingTelemetrySection chargingTelemetry={chargingTelemetry} />
              </SectionErrorBoundary>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <SectionErrorBoundary name="vehicle-detail:security" fallbackTitle={t('vehicles.detail.section.securityFailed', 'Security section failed to load')}>
                  <SecuritySection securityData={securityData} state={state} />
                </SectionErrorBoundary>
                <SectionErrorBoundary name="vehicle-detail:tire-pressure" fallbackTitle={t('vehicles.detail.section.tireFailed', 'Tire pressure section failed to load')}>
                  <TirePressureSection tireData={tireData} />
                </SectionErrorBoundary>
              </div>
            </section>
          </FadeIn>

          {/* Battery & range charts — full-width, internal 2-col grid */}
          <FadeIn delay={0.12}>
            <section className="space-y-4">
              <SectionTitle>{t('vehicles.detail.batteryRange', 'Battery & Range')}</SectionTitle>
              <SectionErrorBoundary name="vehicle-detail:battery-charts" fallbackTitle={t('vehicles.detail.section.batteryChartsFailed', 'Battery & range charts failed to load')}>
                <BatteryRangeCharts state={state} drives={drives} />
              </SectionErrorBoundary>
            </section>
          </FadeIn>

          {/* Recent activity — drives + charges side by side on wide screens */}
          <FadeIn delay={0.14}>
            <section className="space-y-4">
              <SectionTitle>{t('vehicles.detail.recentActivity', 'Recent Activity')}</SectionTitle>
              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <SectionErrorBoundary name="vehicle-detail:recent-drives" fallbackTitle={t('vehicles.detail.section.recentDrivesFailed', 'Recent drives failed to load')}>
                  <RecentDrivesSection drives={drives} />
                </SectionErrorBoundary>
                <SectionErrorBoundary name="vehicle-detail:recent-charges" fallbackTitle={t('vehicles.detail.section.recentChargesFailed', 'Recent charges failed to load')}>
                  <RecentChargesSection sessions={sessions} />
                </SectionErrorBoundary>
              </div>
            </section>
          </FadeIn>

          {/* Configuration + Helix paint preview — auto-fit so the AI card
              (which self-hides when the feature is off) gracefully collapses
              the row to a single full-width configuration panel. */}
          <FadeIn delay={0.16}>
            <section className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(22rem,1fr))]">
              <SectionErrorBoundary name="vehicle-detail:vehicle-config" fallbackTitle={t('vehicles.detail.section.vehicleConfigFailed', 'Vehicle config section failed to load')}>
                <VehicleConfigSection vehicleConfig={vehicleConfig} softwareVersion={state.software_version} />
              </SectionErrorBoundary>
              <SectionErrorBoundary name="vehicle-detail:ai-paint-preview" fallbackTitle={t('vehicles.detail.section.aiPaintPreviewFailed', 'Helix paint preview failed to load')}>
                <AIVehiclePaintPreview vehicleId={vehicleId} />
              </SectionErrorBoundary>
            </section>
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
        </>
      )}
    </PageContainer>
  )
}
