import { useTranslation } from 'react-i18next'
import {
  useEnterpriseRoles,
  useRefreshEnterpriseRoles,
} from '@/api/hooks/useVehicles'
import { ManagementEndpointCard } from './ManagementEndpointCard'

interface EnterpriseRolesCardProps {
  vehicleId?: number
}

export function EnterpriseRolesCard({ vehicleId }: EnterpriseRolesCardProps) {
  const { t } = useTranslation()
  const selectedId = vehicleId ? String(vehicleId) : undefined
  const roles = useEnterpriseRoles(selectedId)
  const refreshRoles = useRefreshEnterpriseRoles(selectedId)

  return (
    <ManagementEndpointCard
      endpointId="enterprise-roles"
      title={t('vehicleManagement.roles.title', 'Enterprise roles')}
      description={t(
        'vehicleManagement.roles.description',
        'Cached business roles for the selected VIN. Refresh is the only action that contacts Tesla.',
      )}
      endpoint="GET /api/1/dx/enterprise/v1/{vin}/roles"
      prerequisite="enterprise"
      kind="roles"
      data={roles.data?.data}
      fetchedAt={roles.data?.fetched_at}
      loading={roles.isLoading}
      error={refreshRoles.error ?? roles.error}
      refreshPending={refreshRoles.isPending}
      operationSucceeded={refreshRoles.isSuccess}
      unavailable={!selectedId}
      onRefresh={() => refreshRoles.mutate()}
    />
  )
}
