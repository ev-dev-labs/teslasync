import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/feedback'
import { Badge, Table, Text } from '@/components/ui'
import { isSensitiveManagementKey } from './managementJson'
import { parseManagementScalarFields } from './managementData'
import { ManagementRawDetails } from './ManagementRawDetails'

interface VehicleSpecsDataViewProps {
  data: unknown
}

export function VehicleSpecsDataView({ data }: VehicleSpecsDataViewProps) {
  const { t } = useTranslation()
  const fields = parseManagementScalarFields(data).filter(
    (field) => !isSensitiveManagementKey(field.key),
  )

  if (fields.length === 0) {
    return (
      <div>
        <EmptyState /* no-action: refresh and management controls are provided by the parent workspace */
          title={t(
            'vehicleManagement.specs.emptyTitle',
            'No specifications returned',
          )}
          message={t(
            'vehicleManagement.specs.emptyDetail',
            'Tesla returned a response, but it did not contain recognizable specification fields.',
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
          'vehicleManagement.specs.resultSummary',
          '{{count}} specification fields returned',
          { count: fields.length },
        )}
      </Text>
      <Table aria-label={t('vehicleManagement.specs.title', 'Vehicle specifications')}>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key}>
              <th scope="row" className="font-normal">
                <Text variant="label">{field.label}</Text>
              </th>
              <td className={typeof field.value === 'number' ? 'text-right tabular-nums' : undefined}>
                {typeof field.value === 'boolean' ? (
                  <Badge variant={field.value ? 'success' : 'neutral'}>
                    {field.value
                      ? t('vehicleManagement.data.true', 'Yes')
                      : t('vehicleManagement.data.false', 'No')}
                  </Badge>
                ) : (
                  <Text
                    variant="body"
                    weight="semibold"
                    mono={typeof field.value === 'number'}
                  >
                    {String(field.value)}
                  </Text>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ManagementRawDetails value={data} />
    </div>
  )
}
