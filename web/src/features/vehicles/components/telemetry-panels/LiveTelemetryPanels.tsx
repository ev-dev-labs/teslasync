import { useTranslation } from 'react-i18next'
import { FadeIn } from '@/components/motion'
import type {
  MotorSnapshot,
  ClimateSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  ChargingTelemetry,
  MediaSnapshot,
  LocationSnapshot,
} from '@/api/types'
import { PowertrainPanel } from './PowertrainPanel'
import { ClimatePanel } from './ClimatePanel'
import { SecurityPanel } from './SecurityPanel'
import { VehicleStatePanel } from './VehicleStatePanel'
import { TirePressurePanel } from './TirePressurePanel'
import { EnergyChargingPanel } from './EnergyChargingPanel'
import { MediaNavigationPanel } from './MediaNavigationPanel'

interface LiveTelemetryProps {
  motorData: MotorSnapshot | null | undefined
  climateData: ClimateSnapshot | null | undefined
  securityData: SecurityEvent | null | undefined
  tireData: TirePressureSnapshot | null | undefined
  chargingTelemetry: ChargingTelemetry | null | undefined
  mediaData: MediaSnapshot | null | undefined
  locationData: LocationSnapshot | null | undefined
  live: Record<string, unknown>
  sseConnected: boolean
  remoteStartEnabled?: boolean | null
}

// Stable empty-object fallback for the `live` signal map. VehicleStatePanel
// reads keys straight off `live`, so a nullish value would throw; coalescing to
// this shared constant keeps it null-safe without allocating a fresh literal in
// the render path.
const EMPTY_LIVE: Record<string, unknown> = {}

export function LiveTelemetryPanels({
  motorData,
  climateData,
  securityData,
  tireData,
  chargingTelemetry,
  mediaData,
  locationData,
  live,
  sseConnected,
  remoteStartEnabled,
}: LiveTelemetryProps) {
  const { t } = useTranslation()

  return (
    <>
      {/* Section header with live indicator */}
      <FadeIn delay={0.12}>
        <div className="flex items-center gap-3 mt-2">
          <span className="relative flex h-3 w-3" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </span>
          <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
            {t('common.liveTelemetry', 'Live Telemetry')}
          </h2>
        </div>
      </FadeIn>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FadeIn delay={0.14}>
          <PowertrainPanel motorData={motorData} />
        </FadeIn>

        <FadeIn delay={0.16}>
          <ClimatePanel climateData={climateData} />
        </FadeIn>

        <FadeIn delay={0.18}>
          <SecurityPanel securityData={securityData} remoteStartEnabled={remoteStartEnabled} />
        </FadeIn>

        <FadeIn delay={0.19}>
          <VehicleStatePanel live={live ?? EMPTY_LIVE} sseConnected={sseConnected} />
        </FadeIn>

        <FadeIn delay={0.2}>
          <TirePressurePanel tireData={tireData} />
        </FadeIn>

        <FadeIn delay={0.22}>
          <EnergyChargingPanel chargingTelemetry={chargingTelemetry} />
        </FadeIn>

        <FadeIn delay={0.24}>
          <MediaNavigationPanel mediaData={mediaData} locationData={locationData} />
        </FadeIn>
      </div>
    </>
  )
}
