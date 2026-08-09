import { useTranslation } from 'react-i18next'
import { Accordion } from '@/components/ui'
import { StructuredDataView } from './StructuredDataView'

interface ManagementRawDetailsProps {
  value: unknown
}

export function ManagementRawDetails({ value }: ManagementRawDetailsProps) {
  const { t } = useTranslation()

  return (
    <Accordion
      title={t(
        'vehicleManagement.data.technicalDetails',
        'Technical response details',
      )}
      className="mt-3"
      bodyClassName="max-h-80 overflow-auto p-3"
    >
      <StructuredDataView value={value} />
    </Accordion>
  )
}
