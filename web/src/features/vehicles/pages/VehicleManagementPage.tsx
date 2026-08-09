import { useTranslation } from 'react-i18next'
import { VehicleSelect } from '@/components/forms'
import { PageContainer } from '@/components/layout'
import { AlertBanner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { Button } from '@/components/ui'
import { useVehicles } from '@/api/hooks/useVehicles'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { VehicleManagementWorkspace } from '../components/vehicle-management'

export default function VehicleManagementPage() {
  const { t } = useTranslation()
  usePageTitle(t('vehicleManagement.pageTitle', 'Vehicle Management'))

  const vehiclesQuery = useVehicles()
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
    <PageContainer
      title={t('vehicleManagement.pageTitle', 'Vehicle Management')}
      subtitle={t(
        'vehicleManagement.pageSubtitle',
        'Review Tesla account metadata, paid specifications, pricing, and enterprise access separately from physical commands.',
      )}
      actions={
        <VehicleSelect
          id="vehicle-management-vehicle"
          ariaLabel={t(
            'vehicleManagement.selectVehicle',
            'Select management vehicle',
          )}
          className="min-h-11 min-w-48"
          withIcon
        />
      }
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

        {vehiclesQuery.error && (
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
          !vehiclesQuery.error &&
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
    </PageContainer>
  )
}
