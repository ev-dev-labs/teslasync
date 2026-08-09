import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/feedback'
import { Badge, Text } from '@/components/ui'
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
        <EmptyState
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
      <dl className="grid gap-2 sm:grid-cols-2">
        {fields.map((field) => (
          <div
            key={field.key}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
          >
            <dt>
              <Text variant="label">{field.label}</Text>
            </dt>
            <dd className="mt-1">
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
            </dd>
          </div>
        ))}
      </dl>
      <ManagementRawDetails value={data} />
    </div>
  )
}
