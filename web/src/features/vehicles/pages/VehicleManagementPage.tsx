import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PageContainer } from '@/components/layout'
import { AlertBanner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { Badge, Button, Select } from '@/components/ui'
import { useVehicles } from '@/api/hooks/useVehicles'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import { Icons } from '@/lib/icons'
import { VehicleManagementWorkspace } from '../components/vehicle-management'

export default function VehicleManagementPage() {
  const { t } = useTranslation()
  usePageTitle(t('vehicleManagement.pageTitle', 'Vehicle Management'))

  const vehiclesQuery = useVehicles()
  const {
    vehicleId,
    vehicle: selectedFromStore,
    setVehicleId,
  } = useSelectedVehicle()
  const vehicles = vehiclesQuery.data ?? []
  const selectedVehicle =
    selectedFromStore ??
    (vehicleId != null
      ? vehicles.find((vehicle) => vehicle.id === vehicleId) ?? null
      : null) ??
    vehicles[0] ??
    null

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        value: String(vehicle.id),
        label:
          vehicle.display_name?.trim() ||
          vehicle.vin ||
          t('vehicleManagement.vehicle.fallbackName', 'Vehicle {{id}}', {
            id: vehicle.id,
          }),
      })),
    [t, vehicles],
  )

  const selectedName = selectedVehicle
    ? selectedVehicle.display_name?.trim() ||
      selectedVehicle.vin ||
      t('vehicleManagement.vehicle.fallbackName', 'Vehicle {{id}}', {
        id: selectedVehicle.id,
      })
    : null

  return (
    <PageContainer
      title={t('vehicleManagement.pageTitle', 'Vehicle Management')}
      subtitle={t(
        'vehicleManagement.pageSubtitle',
        'Review Tesla account metadata, paid specifications, pricing, and enterprise access separately from physical commands.',
      )}
      actions={
        vehicles.length > 1 ? (
          <Select
            id="vehicle-management-vehicle"
            aria-label={t(
              'vehicleManagement.selectVehicle',
              'Select management vehicle',
            )}
            value={selectedVehicle ? String(selectedVehicle.id) : ''}
            onChange={(event) => {
              const next = Number(event.target.value)
              if (Number.isFinite(next) && next > 0) setVehicleId(next)
            }}
            options={vehicleOptions}
            className="min-h-11 min-w-48"
          />
        ) : selectedName ? (
          <Badge variant="neutral" size="lg" className="min-h-11">
            <Icons.vehicle className="h-3.5 w-3.5" aria-hidden="true" />
            {selectedName}
          </Badge>
        ) : null
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
              'Vehicle-scoped cards remain unavailable while the fleet loads. Cached account-level warranty data can still load.',
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
                  'The vehicle list could not be loaded. Account-level cached data remains available.',
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
                'Connect and sync a Tesla vehicle to enable vehicle-scoped management APIs. Account-level warranty data remains available.',
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
