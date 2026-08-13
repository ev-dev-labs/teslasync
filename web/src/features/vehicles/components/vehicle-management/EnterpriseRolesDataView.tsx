import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/feedback'
import { Badge, Text } from '@/components/ui'
import { Icons } from '@/lib/icons'
import {
  humanizeManagementLabel,
  parseEnterpriseRoles,
} from './managementData'
import { ManagementRawDetails } from './ManagementRawDetails'

interface EnterpriseRolesDataViewProps {
  data: unknown
}

export function EnterpriseRolesDataView({
  data,
}: EnterpriseRolesDataViewProps) {
  const { t } = useTranslation()
  const roles = parseEnterpriseRoles(data)

  if (roles.length === 0) {
    return (
      <div>
        <EmptyState
          title={t(
            'vehicleManagement.roles.emptyTitle',
            'No enterprise roles returned',
          )}
          message={t(
            'vehicleManagement.roles.emptyDetail',
            'Tesla returned a response, but it did not include enterprise roles for this vehicle.',
          )}
          className="py-5"
        />
        <ManagementRawDetails value={data} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Text variant="bodySm" as="p">
        {t(
          'vehicleManagement.roles.resultSummary',
          '{{count}} enterprise roles returned',
          { count: roles.length },
        )}
      </Text>
      <div className="flex flex-wrap gap-2">
        {roles.map((role) => (
          <Badge key={role} variant="info" size="lg">
            <Icons.securityCheck className="h-4 w-4" aria-hidden="true" />
            {humanizeManagementLabel(role)}
          </Badge>
        ))}
      </div>
      <ManagementRawDetails value={data} />
    </div>
  )
}
