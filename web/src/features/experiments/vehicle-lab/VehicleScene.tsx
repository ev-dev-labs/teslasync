import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Caption, Text } from '@/components/ui'
import { DataSourceNotice, ErrorBoundary } from '@/components/feedback'
import { FreshnessDot } from '@/components/data-display'
import { canUseWebGL } from './sceneCapabilities'
import VehicleSummary from './VehicleSummary'
import { useVehicleLabState } from './useVehicleLabState'
import VehicleReadings from './VehicleReadings'
import VehiclePartDetails from './VehiclePartDetails'
import type { VehicleReadingId } from './useVehicleReadings'

const VehicleStudioCanvas = lazy(() => import('./VehicleStudioCanvas'))

export default function VehicleScene() {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(canUseWebGL)
  const [selected, setSelected] = useState<VehicleReadingId | null>(null)
  const { state, query, vehicleId, vehiclesQuery } = useVehicleLabState()
  const unavailable = <Text as="p" role="status" className="rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] p-5">
    {t('experiments.vehicleLab.webglUnavailable', '3D is unavailable on this device. Every vehicle signal remains readable below.')}
  </Text>

  return (
    <section className="mt-6 space-y-4" aria-label={t('experiments.vehicleLab.studio', 'Vehicle studio')}>
      <Caption as="p">{t('experiments.vehicleLab.illustrative', 'Original illustrative model, not a manufacturer asset. Unknown signals never imply closed doors or normal readings.')}</Caption>
      <div className="flex items-start gap-3">
        <DataSourceNotice className="min-w-0 flex-1" sources={[
          { id: 'vehicles', label: t('common.vehicles', 'Vehicles'), query: vehiclesQuery },
          { id: 'signals', label: t('experiments.vehicleLab.summary', 'Vehicle state'), query, enabled: vehicleId !== null },
        ]} />
        <FreshnessDot updatedAt={state.observedAt} isFetching={query.isFetching} isStale={state.stale || state.observedAt === null} isError={query.isError} onRefresh={vehicleId === null ? undefined : () => { void query.refetch() }} source={t('experiments.vehicleLab.summary', 'Vehicle state')} />
      </div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-4">
          <VehicleReadings state={state} />
          <ErrorBoundary name="vehicle-studio" fallback={unavailable}>
            {available ? (
              <Suspense fallback={<Text as="p" role="status">{t('experiments.vehicleLab.loading', 'Opening the vehicle studio...')}</Text>}>
                <VehicleStudioCanvas state={state} onUnavailable={() => setAvailable(false)} onSelect={setSelected} />
              </Suspense>
            ) : unavailable}
          </ErrorBoundary>
        </div>
        <VehicleSummary state={state} onSelect={setSelected} />
      </div>
      <VehiclePartDetails selected={selected} state={state} onClose={() => setSelected(null)} />
    </section>
  )
}
