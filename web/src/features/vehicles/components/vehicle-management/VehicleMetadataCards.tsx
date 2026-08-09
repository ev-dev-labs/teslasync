import { useTranslation } from 'react-i18next'
import {
  useRefreshVehicleOptions,
  useRefreshVehicleSubscriptions,
  useRefreshVehicleUpgrades,
  useRefreshWarrantyDetails,
  useVehicleOptions,
  useVehicleSubscriptions,
  useVehicleUpgrades,
  useWarrantyDetails,
} from '@/api/hooks/useVehicles'
import { ManagementEndpointCard } from './ManagementEndpointCard'

interface VehicleMetadataCardsProps {
  vehicleId?: number
}

export function VehicleMetadataCards({ vehicleId }: VehicleMetadataCardsProps) {
  const { t } = useTranslation()
  const selectedId = vehicleId ? String(vehicleId) : undefined
  const options = useVehicleOptions(selectedId)
  const subscriptions = useVehicleSubscriptions(selectedId)
  const upgrades = useVehicleUpgrades(selectedId)
  const warranty = useWarrantyDetails()
  const refreshOptions = useRefreshVehicleOptions(selectedId)
  const refreshSubscriptions = useRefreshVehicleSubscriptions(selectedId)
  const refreshUpgrades = useRefreshVehicleUpgrades(selectedId)
  const refreshWarranty = useRefreshWarrantyDetails()
  const vehicleUnavailable = !selectedId

  return (
    <>
      <ManagementEndpointCard
        endpointId="vehicle-options"
        title={t('vehicleManagement.options.title', 'Vehicle options')}
        description={t(
          'vehicleManagement.options.description',
          'Option codes and factory configuration available to the connected Tesla user.',
        )}
        endpoint="GET /api/1/dx/vehicles/options?vin={vin}"
        prerequisite="user"
        kind="options"
        data={options.data?.data}
        fetchedAt={options.data?.fetched_at}
        loading={options.isLoading}
        error={refreshOptions.error ?? options.error}
        refreshPending={refreshOptions.isPending}
        operationSucceeded={refreshOptions.isSuccess}
        unavailable={vehicleUnavailable}
        onRefresh={() => refreshOptions.mutate()}
      />

      <ManagementEndpointCard
        endpointId="warranty-details"
        title={t('vehicleManagement.warranty.title', 'Warranty details')}
        description={t(
          'vehicleManagement.warranty.description',
          'Tesla account warranty coverage details; VIN behavior can vary by account.',
        )}
        endpoint="GET /api/1/dx/warranty/details"
        prerequisite="user"
        kind="warranty"
        data={warranty.data?.data}
        fetchedAt={warranty.data?.fetched_at}
        loading={warranty.isLoading}
        error={refreshWarranty.error ?? warranty.error}
        refreshPending={refreshWarranty.isPending}
        operationSucceeded={refreshWarranty.isSuccess}
        onRefresh={() => refreshWarranty.mutate()}
      />

      <ManagementEndpointCard
        endpointId="subscription-eligibility"
        title={t(
          'vehicleManagement.subscriptions.title',
          'Subscription eligibility',
        )}
        description={t(
          'vehicleManagement.subscriptions.description',
          'Eligibility information for Tesla vehicle subscriptions.',
        )}
        endpoint="GET /api/1/dx/vehicles/subscriptions/eligibility?vin={vin}"
        prerequisite="user"
        kind="subscriptions"
        data={subscriptions.data?.data}
        fetchedAt={subscriptions.data?.fetched_at}
        loading={subscriptions.isLoading}
        error={refreshSubscriptions.error ?? subscriptions.error}
        refreshPending={refreshSubscriptions.isPending}
        operationSucceeded={refreshSubscriptions.isSuccess}
        unavailable={vehicleUnavailable}
        onRefresh={() => refreshSubscriptions.mutate()}
      />

      <ManagementEndpointCard
        endpointId="upgrade-eligibility"
        title={t('vehicleManagement.upgrades.title', 'Upgrade eligibility')}
        description={t(
          'vehicleManagement.upgrades.description',
          'Available or eligible Tesla vehicle upgrades returned for the selected VIN.',
        )}
        endpoint="GET /api/1/dx/vehicles/upgrades/eligibility?vin={vin}"
        prerequisite="user"
        kind="upgrades"
        data={upgrades.data?.data}
        fetchedAt={upgrades.data?.fetched_at}
        loading={upgrades.isLoading}
        error={refreshUpgrades.error ?? upgrades.error}
        refreshPending={refreshUpgrades.isPending}
        operationSucceeded={refreshUpgrades.isSuccess}
        unavailable={vehicleUnavailable}
        onRefresh={() => refreshUpgrades.mutate()}
      />
    </>
  )
}
