import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import { AlertBanner, EmptyState, Spinner } from '@/components/feedback'
import { Badge } from '@/components/ui'
import {
  managementErrorText,
  summarizeManagementData,
  type ManagementEndpointKind,
} from './managementJson'
import { StructuredDataView } from './StructuredDataView'

interface ManagementEndpointBodyProps {
  data: unknown
  loading: boolean
  error?: unknown
  unavailable: boolean
  kind: ManagementEndpointKind
  emptyTitle?: string
  emptyMessage?: string
}

function hasRenderableData(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

export function ManagementEndpointBody({
  data,
  loading,
  error,
  unavailable,
  kind,
  emptyTitle,
  emptyMessage,
}: ManagementEndpointBodyProps) {
  const { t } = useTranslation()
  const recordData =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : null
  const summary = summarizeManagementData(recordData, kind)
  const capabilityUnavailable =
    isApiError(error) && [401, 402, 403, 412].includes(error.status)
  const summaryLabels = {
    model: t('vehicleManagement.summary.model', 'Model'),
    trim: t('vehicleManagement.summary.trim', 'Trim'),
    status: t('vehicleManagement.summary.status', 'Status'),
    expiry: t('vehicleManagement.summary.expiry', 'Expiry'),
    items: t('vehicleManagement.summary.items', 'Items'),
    fields: t('vehicleManagement.summary.fields', 'Fields returned'),
    roles: t('vehicleManagement.summary.roles', 'Roles'),
  }

  if (unavailable) {
    return (
      // no-action: Vehicle selection is owned by the workspace selector above the endpoint cards.
      <EmptyState
        title={t('vehicleManagement.state.vehicleRequired', 'Select a vehicle')}
        message={t(
          'vehicleManagement.state.vehicleRequiredDetail',
          'This endpoint is unavailable until a vehicle is selected.',
        )}
        className="py-5"
      />
    )
  }
  if (loading) {
    return (
      <Spinner
        size="sm"
        label={t('vehicleManagement.state.loading', 'Loading cached data')}
        className="py-5"
      />
    )
  }
  if (capabilityUnavailable) {
    return (
      <AlertBanner
        variant="warning"
        title={t('vehicleManagement.state.unavailable', 'Capability unavailable')}
      >
        {managementErrorText(
          error,
          t(
            'vehicleManagement.state.prerequisiteError',
            'Tesla did not confirm the required account scope or prerequisite.',
          ),
        )}
      </AlertBanner>
    )
  }
  if (error) {
    return (
      <AlertBanner
        variant="danger"
        title={t('vehicleManagement.state.error', 'Request failed')}
      >
        {managementErrorText(
          error,
          t(
            'vehicleManagement.state.errorDetail',
            'The request could not be completed.',
          ),
        )}
      </AlertBanner>
    )
  }
  if (hasRenderableData(data)) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {summary.map((item) => (
            <Badge key={`${item.label}-${item.value}`} variant="neutral">
              {summaryLabels[item.label]}: {item.value}
            </Badge>
          ))}
        </div>
        <StructuredDataView value={data} />
      </div>
    )
  }
  return (
    // no-action: Refresh and operation actions are already exposed in the endpoint card header.
    <EmptyState
      title={emptyTitle ?? t('vehicleManagement.state.empty', 'No cached data')}
      message={
        emptyMessage ??
        t(
          'vehicleManagement.state.emptyDetail',
          'Use refresh to request this information from Tesla when the required access is available.',
        )
      }
      className="py-5"
    />
  )
}
