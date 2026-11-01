import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Caption, Text } from '@/components/ui'
import { ErrorBoundary } from '@/components/feedback'
import { canUseWebGL } from './sceneCapabilities'
import VehicleSummary from './VehicleSummary'

const VehicleStudioCanvas = lazy(() => import('./VehicleStudioCanvas'))

export default function VehicleScene() {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(canUseWebGL)
  const unavailable = <Text as="p" role="status" className="rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] p-5">
    {t('experiments.vehicleLab.webglUnavailable', '3D is unavailable on this device. Every vehicle signal remains readable below.')}
  </Text>

  return (
    <section className="mt-6 space-y-4" aria-label={t('experiments.vehicleLab.studio', 'Vehicle studio')}>
      <Caption as="p">{t('experiments.vehicleLab.illustrative', 'Original illustrative model, not a manufacturer asset. Unknown signals never imply closed doors or normal readings.')}</Caption>
      <ErrorBoundary name="vehicle-studio" fallback={unavailable}>
        {available ? (
          <Suspense fallback={<Text as="p" role="status">{t('experiments.vehicleLab.loading', 'Opening the vehicle studio...')}</Text>}>
            <VehicleStudioCanvas onUnavailable={() => setAvailable(false)} />
          </Suspense>
        ) : unavailable}
      </ErrorBoundary>
      <VehicleSummary />
    </section>
  )
}
