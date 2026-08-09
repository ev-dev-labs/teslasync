import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useRefreshVehicleSpecs,
  useVehicleSpecs,
} from '@/api/hooks/useVehicles'
import { AlertBanner } from '@/components/feedback'
import { ConfirmDialog } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { ManagementEndpointCard } from './ManagementEndpointCard'

interface PaidVehicleSpecsCardProps {
  vehicleId?: number
}

export function PaidVehicleSpecsCard({ vehicleId }: PaidVehicleSpecsCardProps) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const selectedId = vehicleId ? String(vehicleId) : undefined
  const specs = useVehicleSpecs(selectedId)
  const refreshSpecs = useRefreshVehicleSpecs(selectedId)

  return (
    <>
      <ManagementEndpointCard
        endpointId="vehicle-specs"
        title={t('vehicleManagement.specs.title', 'Vehicle specifications')}
        description={t(
          'vehicleManagement.specs.description',
          'Partner-scoped vehicle specifications cached for 24 hours by TeslaSync.',
        )}
        endpoint="GET /api/1/vehicles/{vin}/specs"
        prerequisite="partner"
        kind="specs"
        data={specs.data?.data}
        fetchedAt={specs.data?.fetched_at}
        loading={specs.isLoading}
        error={refreshSpecs.error ?? specs.error}
        refreshPending={refreshSpecs.isPending}
        operationSucceeded={refreshSpecs.isSuccess}
        unavailable={!selectedId}
        warning={
          <AlertBanner
            variant="warning"
            icon={<Icons.dollarSign className="h-4 w-4" />}
            title={t('vehicleManagement.specs.costTitle', 'Paid Tesla API result')}
          >
            {t(
              'vehicleManagement.specs.costWarning',
              'Tesla bills $0.10 for each successful specifications result. TeslaSync also enforces a 24-hour refresh guard.',
            )}
          </AlertBanner>
        }
        onRefresh={() => setConfirmOpen(true)}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={t(
          'vehicleManagement.specs.confirmTitle',
          'Request paid vehicle specifications?',
        )}
        message={t(
          'vehicleManagement.specs.confirmMessage',
          'A successful Tesla response costs $0.10. Continue only if the cached result needs updating.',
        )}
        confirmLabel={t('vehicleManagement.specs.confirmAction', 'Request $0.10 result')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="warning"
        loading={refreshSpecs.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          refreshSpecs.mutate()
        }}
      />
    </>
  )
}
