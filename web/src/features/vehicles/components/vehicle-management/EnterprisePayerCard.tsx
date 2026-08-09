import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TeslaOpaqueObject } from '@/api/types'
import { useSetEnterprisePayer } from '@/api/hooks/useVehicles'
import { AlertBanner } from '@/components/feedback'
import { ConfirmDialog } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { ManagementEndpointCard } from './ManagementEndpointCard'
import { OpaqueJsonDialog } from './OpaqueJsonDialog'

interface EnterprisePayerCardProps {
  vehicleId?: number
}

const PAYER_CONFIRMATION = 'PAYER'

export function EnterprisePayerCard({ vehicleId }: EnterprisePayerCardProps) {
  const { t } = useTranslation()
  const selectedId = vehicleId ? String(vehicleId) : undefined
  const payer = useSetEnterprisePayer(selectedId)
  const [jsonDialogOpen, setJSONDialogOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [stagedPayload, setStagedPayload] =
    useState<TeslaOpaqueObject | null>(null)

  const clearConfirmation = () => {
    setConfirmOpen(false)
    setStagedPayload(null)
  }

  return (
    <>
      <ManagementEndpointCard
        endpointId="enterprise-payer"
        title={t('vehicleManagement.payer.title', 'Enterprise payer')}
        description={t(
          'vehicleManagement.payer.description',
          'State-changing enterprise billing operation for the selected vehicle.',
        )}
        endpoint="POST /api/1/dx/enterprise/v1/{vin}/payer"
        prerequisite="enterprise"
        kind="payer"
        data={payer.data?.data}
        error={payer.error}
        refreshPending={payer.isPending}
        operationSucceeded={payer.isSuccess}
        unavailable={!selectedId}
        actionLabel={t('vehicleManagement.payer.action', 'Configure payer change')}
        emptyTitle={t('vehicleManagement.payer.empty', 'No payer change submitted')}
        emptyMessage={t(
          'vehicleManagement.payer.emptyDetail',
          'Payer request objects are never cached. A successful response is shown only for the current session.',
        )}
        warning={
          <AlertBanner
            variant="danger"
            icon={<Icons.wallet className="h-4 w-4" />}
            title={t(
              'vehicleManagement.payer.warningTitle',
              'Changes enterprise billing responsibility',
            )}
          >
            {t(
              'vehicleManagement.payer.warning',
              'Only continue with an object supplied by an authorized Tesla enterprise workflow. Access is not assumed.',
            )}
          </AlertBanner>
        }
        onRefresh={() => setJSONDialogOpen(true)}
      />

      <OpaqueJsonDialog
        open={jsonDialogOpen}
        title={t('vehicleManagement.payer.dialogTitle', 'Prepare payer change')}
        description={t(
          'vehicleManagement.payer.schema',
          'Tesla controls this undocumented schema. TeslaSync validates only that the payload is a non-empty JSON object.',
        )}
        submitLabel={t('vehicleManagement.payer.continue', 'Continue to confirmation')}
        destructive
        onClose={() => setJSONDialogOpen(false)}
        onSubmit={(payload) => {
          setStagedPayload(payload)
          setJSONDialogOpen(false)
          setConfirmOpen(true)
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={t(
          'vehicleManagement.payer.confirmTitle',
          'Confirm enterprise payer change',
        )}
        message={t(
          'vehicleManagement.payer.confirmMessage',
          'This changes enterprise billing responsibility for the selected vehicle. TeslaSync will send the staged object only after this confirmation.',
        )}
        confirmLabel={t('vehicleManagement.payer.confirmAction', 'Change enterprise payer')}
        cancelLabel={t('common.cancel', 'Cancel')}
        requireTypedConfirmation={PAYER_CONFIRMATION}
        typedConfirmationLabel={t(
          'vehicleManagement.payer.typeConfirmation',
          'Type PAYER to confirm the billing change',
        )}
        variant="danger"
        loading={payer.isPending}
        onCancel={clearConfirmation}
        onConfirm={() => {
          if (!stagedPayload) return
          const payload = stagedPayload
          clearConfirmation()
          payer.mutate({ payload, confirmed: true })
        }}
      />
    </>
  )
}
