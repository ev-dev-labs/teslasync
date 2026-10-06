import { useTranslation } from 'react-i18next'

import { PageLayout } from '@/components/layout'
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { Button } from '@/components/ui'
import { useVehicles } from '@/api/hooks/useVehicles'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { useDataState } from '@/hooks/useDataState'
import { VehicleManagementWorkspace } from '../components/vehicle-management'

export default function VehicleManagementPage() {
  const { t } = useTranslation()
  usePageTitle(t('vehicleManagement.pageTitle', 'Vehicle management'))

  const vehiclesQuery = useVehicles()
  const vehiclesState = useDataState(vehiclesQuery)
  const {
    vehicleId,
    vehicle: selectedFromStore,
  } = useSelectedVehicle()
  const vehicles = vehiclesQuery.data ?? []
  const selectedVehicle =
    selectedFromStore ??
    (vehicleId != null
      ? vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null
      : null) ??
    vehicles[0] ??
    null

  return (
    <PageLayout
      title={t('vehicleManagement.pageTitle', 'Vehicle management')}
      subtitle={t(
        'vehicleManagement.pageSubtitle',
        'Review Tesla account metadata, paid specifications, pricing, and enterprise access separately from physical commands.',
      )}
    >
      <div className="space-y-4">
        {vehiclesQuery.isLoading && (
          <AlertBanner
            variant="info"
            title={t(
              'vehicleManagement.roster.loadingTitle',
              'Loading vehicle context',
            )}
          >
            {t(
              'vehicleManagement.roster.loading',
              'Vehicle-scoped management data remains unavailable while the fleet loads.',
            )}
          </AlertBanner>
        )}

        <StaleRefreshWarning state={vehiclesState} label={t('vehicleManagement.pageTitle', 'Vehicle management')} />
        {vehiclesState.fatalError && (
          <AlertBanner
            variant="danger"
            title={t(
              'vehicleManagement.roster.errorTitle',
              'Vehicle context unavailable',
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {t(
                  'vehicleManagement.roster.error',
                  'The vehicle list could not be loaded, so vehicle-scoped management data is unavailable.',
                )}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void vehiclesQuery.refetch()}
              >
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          </AlertBanner>
        )}

        {!vehiclesQuery.isLoading &&
          !vehiclesState.fatalError &&
          vehicles.length === 0 && (
            <AlertBanner
              variant="info"
              title={t(
                'vehicleManagement.roster.emptyTitle',
                'No vehicles available',
              )}
            >
              {t(
                'vehicleManagement.roster.empty',
                'Connect and sync a Tesla vehicle to enable vehicle-scoped management APIs.',
              )}
            </AlertBanner>
          )}

        <FadeIn>
          <VehicleManagementWorkspace
            key={selectedVehicle?.id ?? 'no-vehicle'}
            vehicleId={selectedVehicle?.id}
          />
        </FadeIn>
      </div>
    </PageLayout>
  )
}
