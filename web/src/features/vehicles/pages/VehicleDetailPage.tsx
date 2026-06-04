import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'

import { PageContainer } from '@/components/layout'
import { GlassPanel } from '@/components/ui'
import { LiveIndicator } from '@/components/data-display'
import { Skeleton, LiveStaleDataBanner, SectionErrorBoundary, StatGridSkeleton, ChartBlockSkeleton, PageHeaderSkeleton } from '@/components/feedback'
import { FadeIn } from '@/components/motion'

import { usePageTitle } from '@/hooks/usePageTitle'
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

  const { data: stateData, refetch: refetchState } = useQuery({
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => request<StateResponse>(`/vehicles/${vehicleId}/state`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  })

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

  /* ─── Loading short-circuit ─────────── */
  if (vehicleLoading) {
    return <VehicleDetailSkeleton />
  }

  /* ─── Render ─── */

  return (
    <PageContainer
      title={effectiveName ?? t('vehicles.detail.title', 'Vehicle Detail')}
      error={vehicleError as Error | null}
      breadcrumbLabels={{
        '/vehicles/:id': effectiveName ?? `Vehicle #${id}`,
      }}
      actions={<LiveIndicator variant="compact" />}
    >
      <LiveStaleDataBanner />
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
            <Skeleton lines={5} height={20} />
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          <SectionErrorBoundary name="vehicle-detail:battery-range" fallbackTitle={t('vehicles.detail.section.batteryRangeFailed', 'Battery & range section failed to load')}>
            <FadeIn delay={0.04}><BatteryRangePanel state={state} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:live-state" fallbackTitle={t('vehicles.detail.section.liveStateFailed', 'Live state indicators failed to load')}>
            <FadeIn delay={0.06}><LiveStateIndicators state={state} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:quick-stats" fallbackTitle={t('vehicles.detail.section.quickStatsFailed', 'Quick stats failed to load')}>
            <FadeIn delay={0.08}><QuickStatsGrid state={state} status={status} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:motor" fallbackTitle={t('vehicles.detail.section.motorFailed', 'Motor section failed to load')}>
            <FadeIn delay={0.10}><MotorSection motorData={motorData} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:climate" fallbackTitle={t('vehicles.detail.section.climateFailed', 'Climate section failed to load')}>
            <FadeIn delay={0.12}><ClimateSection climateData={climateData} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:security" fallbackTitle={t('vehicles.detail.section.securityFailed', 'Security section failed to load')}>
            <FadeIn delay={0.14}><SecuritySection securityData={securityData} state={state} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:tire-pressure" fallbackTitle={t('vehicles.detail.section.tireFailed', 'Tire pressure section failed to load')}>
            <FadeIn delay={0.16}><TirePressureSection tireData={tireData} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:charging-telemetry" fallbackTitle={t('vehicles.detail.section.chargingTelemetryFailed', 'Charging telemetry failed to load')}>
            <FadeIn delay={0.18}><ChargingTelemetrySection chargingTelemetry={chargingTelemetry} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:battery-charts" fallbackTitle={t('vehicles.detail.section.batteryChartsFailed', 'Battery & range charts failed to load')}>
            <FadeIn delay={0.20}><BatteryRangeCharts state={state} drives={drives} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:recent-drives" fallbackTitle={t('vehicles.detail.section.recentDrivesFailed', 'Recent drives failed to load')}>
            <FadeIn delay={0.22}><RecentDrivesSection drives={drives} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:recent-charges" fallbackTitle={t('vehicles.detail.section.recentChargesFailed', 'Recent charges failed to load')}>
            <FadeIn delay={0.24}><RecentChargesSection sessions={sessions} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:vehicle-config" fallbackTitle={t('vehicles.detail.section.vehicleConfigFailed', 'Vehicle config section failed to load')}>
            <FadeIn delay={0.26}><VehicleConfigSection vehicleConfig={vehicleConfig} softwareVersion={state.software_version} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:ai-paint-preview" fallbackTitle={t('vehicles.detail.section.aiPaintPreviewFailed', 'Helix paint preview failed to load')}>
            <FadeIn delay={0.27}><AIVehiclePaintPreview vehicleId={vehicleId} /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary name="vehicle-detail:quick-links" fallbackTitle={t('vehicles.detail.section.quickLinksFailed', 'Quick links failed to load')}>
            <FadeIn delay={0.28}><QuickLinksSection /></FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:settings"
            fallbackTitle={t('vehicles.detail.section.settingsFailed', 'Per-vehicle settings failed to load')}
          >
            <FadeIn delay={0.30}><VehicleSettingsTab vehicleId={vehicleId} /></FadeIn>
          </SectionErrorBoundary>
        </>
      )}
    </PageContainer>
  )
}
