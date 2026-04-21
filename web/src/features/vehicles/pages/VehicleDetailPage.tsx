import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'

import { PageContainer } from '@/components/layout'
import { GlassPanel } from '@/components/ui'
import { Skeleton } from '@/components/feedback'
import { FadeIn } from '@/components/motion'

import { usePageTitle } from '@/hooks/usePageTitle'
import { useBreadcrumbs } from '@/hooks/useBreadcrumbs'
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

  const breadcrumbs = useBreadcrumbs({
    '/vehicles/:id': vehicle?.display_name ?? `Vehicle #${id}`,
  })

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

  const wakeMutation = useMutation({
    mutationFn: () => request<{ status: string }>(`/vehicles/${vehicleId}/wake`, { method: 'POST' }),
    onSuccess: () => {
      setTimeout(() => { refetchState() }, 5000)
    },
  })

  /* ─── Derived state ─── */

  const state = stateData?.state
  const status: VehicleStatus = vehicle ? deriveStatus(vehicle, state) : 'offline'

  /* ─── Render ─── */

  return (
    <PageContainer
      title={vehicle?.display_name ?? t('vehicles.detail.title', 'Vehicle Detail')}
      loading={vehicleLoading}
      error={vehicleError as Error | null}
      breadcrumbs={breadcrumbs}
    >
      <FadeIn>
        <VehicleHeader
          vehicle={vehicle}
          status={status}
          onWake={() => wakeMutation.mutate()}
          waking={wakeMutation.isPending}
        />
      </FadeIn>

      {!state ? (
        <FadeIn delay={0.05}>
          <GlassPanel className="p-8">
            <Skeleton lines={5} height={20} />
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          <FadeIn delay={0.04}><BatteryRangePanel state={state} /></FadeIn>
          <FadeIn delay={0.06}><LiveStateIndicators state={state} /></FadeIn>
          <FadeIn delay={0.08}><QuickStatsGrid state={state} status={status} /></FadeIn>
          <FadeIn delay={0.10}><MotorSection motorData={motorData} /></FadeIn>
          <FadeIn delay={0.12}><ClimateSection climateData={climateData} /></FadeIn>
          <FadeIn delay={0.14}><SecuritySection securityData={securityData} state={state} /></FadeIn>
          <FadeIn delay={0.16}><TirePressureSection tireData={tireData} /></FadeIn>
          <FadeIn delay={0.18}><ChargingTelemetrySection chargingTelemetry={chargingTelemetry} /></FadeIn>
          <FadeIn delay={0.20}><BatteryRangeCharts state={state} drives={drives} /></FadeIn>
          <FadeIn delay={0.22}><RecentDrivesSection drives={drives} /></FadeIn>
          <FadeIn delay={0.24}><RecentChargesSection sessions={sessions} /></FadeIn>
          <FadeIn delay={0.26}><VehicleConfigSection vehicleConfig={vehicleConfig} softwareVersion={state.software_version} /></FadeIn>
          <FadeIn delay={0.28}><QuickLinksSection /></FadeIn>
        </>
      )}
    </PageContainer>
  )
}
