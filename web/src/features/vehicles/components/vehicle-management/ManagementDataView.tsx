import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui'
import {
  summarizeManagementData,
  type ManagementEndpointKind,
} from './managementJson'
import { EnterpriseRolesDataView } from './EnterpriseRolesDataView'
import { StructuredDataView } from './StructuredDataView'
import { SubscriptionDataView } from './SubscriptionDataView'
import { VehicleOptionsDataView } from './VehicleOptionsDataView'
import { VehicleSpecsDataView } from './VehicleSpecsDataView'
import { WarrantyDataView } from './WarrantyDataView'

interface ManagementDataViewProps {
  data: unknown
  kind: ManagementEndpointKind
}

export function ManagementDataView({
  data,
  kind,
}: ManagementDataViewProps) {
  const { t } = useTranslation()

  if (kind === 'options') return <VehicleOptionsDataView data={data} />
  if (kind === 'specs') return <VehicleSpecsDataView data={data} />
  if (kind === 'warranty') return <WarrantyDataView data={data} />
  if (kind === 'subscriptions') return <SubscriptionDataView data={data} />
  if (kind === 'roles') return <EnterpriseRolesDataView data={data} />

  const recordData =
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown>
      : null
  const summary = summarizeManagementData(recordData, kind)
  const summaryLabels = {
    model: t('vehicleManagement.summary.model', 'Model'),
    trim: t('vehicleManagement.summary.trim', 'Trim'),
    status: t('vehicleManagement.summary.status', 'Status'),
    expiry: t('vehicleManagement.summary.expiry', 'Expiry'),
    items: t('vehicleManagement.summary.items', 'Items'),
    fields: t('vehicleManagement.summary.fields', 'Fields returned'),
    roles: t('vehicleManagement.summary.roles', 'Roles'),
  }

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
