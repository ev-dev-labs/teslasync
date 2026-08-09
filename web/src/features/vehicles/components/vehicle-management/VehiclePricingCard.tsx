import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVehiclePricing } from '@/api/hooks/useVehicles'
import { ManagementEndpointCard } from './ManagementEndpointCard'
import { OpaqueJsonDialog } from './OpaqueJsonDialog'

export function VehiclePricingCard() {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const pricing = useVehiclePricing()

  return (
    <>
      <ManagementEndpointCard
        endpointId="vehicle-pricing"
        title={t('vehicleManagement.pricing.title', 'Vehicle pricing')}
        description={t(
          'vehicleManagement.pricing.description',
          'Read-only partner pricing query sent by POST with a Tesla-defined request object.',
        )}
        endpoint="POST /api/1/dx/vehicles/pricing"
        prerequisite="partner"
        data={pricing.data?.data}
        error={pricing.error}
        refreshPending={pricing.isPending}
        operationSucceeded={pricing.isSuccess}
        actionLabel={t('vehicleManagement.pricing.action', 'Open pricing query')}
        emptyTitle={t('vehicleManagement.pricing.empty', 'No session result')}
        emptyMessage={t(
          'vehicleManagement.pricing.emptyDetail',
          'Pricing payloads are not persisted. Submit a Tesla-controlled JSON object to view a result for this session.',
        )}
        onRefresh={() => setDialogOpen(true)}
      />

      <OpaqueJsonDialog
        open={dialogOpen}
        title={t('vehicleManagement.pricing.dialogTitle', 'Query vehicle pricing')}
        description={t(
          'vehicleManagement.pricing.schema',
          'Tesla does not publish this request schema. Submit only an object obtained from a trusted Tesla workflow; TeslaSync forwards it unchanged in meaning.',
        )}
        submitLabel={t('vehicleManagement.pricing.submit', 'Submit pricing query')}
        pending={pricing.isPending}
        onClose={() => {
          if (!pricing.isPending) setDialogOpen(false)
        }}
        onSubmit={(payload) => {
          pricing.mutate(
            { payload },
            { onSuccess: () => setDialogOpen(false) },
          )
        }}
      />
    </>
  )
}
