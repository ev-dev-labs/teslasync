import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/feedback'
import { DataTable, Text } from '@/components/ui'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { isSensitiveManagementKey } from './managementJson'
import { parseManagementScalarFields } from './managementData'
import { ManagementRawDetails } from './ManagementRawDetails'

interface VehicleSpecsDataViewProps {
  data: unknown
}

function retainsSourcePrecision(key: string): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[_-]+/)
  return words.some((word) =>
    ['id', 'vin', 'code', 'year', 'version', 'timestamp', 'latitude', 'longitude', 'lat', 'lon', 'lng', 'precision'].includes(word),
  )
}

export function VehicleSpecsDataView({ data }: VehicleSpecsDataViewProps) {
  const { t } = useTranslation()
  const { fmtNumber } = useNumberFormatting()
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
      <DataTable
        tableId="vehicle-management:specs"
        caption={t('vehicleManagement.specs.title', 'Vehicle specifications')}
        data={fields.map((field) => ({
          key: field.key,
          label: field.label,
          value: typeof field.value === 'boolean'
            ? (field.value ? t('vehicleManagement.data.true', 'Yes') : t('vehicleManagement.data.false', 'No'))
            : typeof field.value === 'number' && !retainsSourcePrecision(field.key)
              ? fmtNumber(field.value)
              : String(field.value),
        }))}
        columns={[
          { key: 'label', header: t('vehicleManagement.specs.title', 'Vehicle specifications'), defaultWidth: 220, minWidth: 180, render: (row) => <Text variant="label">{row.label}</Text> },
          { key: 'value', header: t('common.value', 'Value'), defaultWidth: 180, minWidth: 140, align: 'right', render: (row) => <Text variant="body" weight="semibold" mono>{row.value}</Text> },
        ]}
        keyExtractor={(row) => row.key}
        variant="embedded"
        stickyHeader={false}
        showColumnsMenu={false}
        columnVisibility={false}
        searchable={false}
        exportable={false}
      />
      <ManagementRawDetails value={data} />
    </div>
  )
}
