import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/feedback'
import { Badge, Code, Heading, Text } from '@/components/ui'
import { Icons } from '@/lib/icons'
import { parseVehicleOptions } from './managementData'
import { ManagementRawDetails } from './ManagementRawDetails'

interface VehicleOptionsDataViewProps {
  data: unknown
}

export function VehicleOptionsDataView({
  data,
}: VehicleOptionsDataViewProps) {
  const { t } = useTranslation()
  const options = parseVehicleOptions(data)
  const activeCount = options.filter((option) => option.isActive === true).length

  if (options.length === 0) {
    return (
      <div>
        <EmptyState /* no-action: refresh and management controls are provided by the parent workspace */
          title={t(
            'vehicleManagement.options.emptyTitle',
            'No vehicle options returned',
          )}
          message={t(
            'vehicleManagement.options.emptyDetail',
            'Tesla returned a response, but it did not contain recognizable option records.',
          )}
          className="py-5"
        />
        <ManagementRawDetails value={data} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text variant="bodySm">
          {t(
            'vehicleManagement.options.resultSummary',
            '{{active}} active of {{total}} options returned',
            { active: activeCount, total: options.length },
          )}
        </Text>
        <Badge variant="success" dot>
          {t('vehicleManagement.options.factoryConfiguration', 'Factory configuration')}
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option, index) => {
          const title =
            option.displayName ??
            option.code ??
            t('vehicleManagement.options.unnamed', 'Option {{index}}', {
              index: index + 1,
            })
          const statusLabel =
            option.isActive === true
              ? t('vehicleManagement.options.active', 'Active')
              : option.isActive === false
                ? t('vehicleManagement.options.inactive', 'Inactive')
                : t(
                    'vehicleManagement.options.unknownStatus',
                    'Status unknown',
                  )

          return (
            <div
              key={`${option.code ?? title}-${index}`}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
            >
              <div className="flex items-start gap-3">
                <div
                  className={
                    option.isActive === true
                      ? 'rounded-lg bg-emerald-500/10 p-2 text-emerald-300'
                      : 'rounded-lg bg-[var(--control-bg)] p-2 text-[var(--text-muted)]'
                  }
                >
                  {option.isActive === false ? (
                    <Icons.close className="h-4 w-4" aria-hidden="true" />
                  ) : option.isActive === true ? (
                    <Icons.confirm className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Icons.helpCircle className="h-4 w-4" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Heading level="sub" as="h4">
                      {title}
                    </Heading>
                    <Badge
                      variant={
                        option.isActive === true ? 'success' : 'neutral'
                      }
                    >
                      {statusLabel}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {option.code && <Code>{option.code}</Code>}
                    {option.colorCode && (
                      <Badge variant="neutral">
                        {t(
                          'vehicleManagement.options.paintCode',
                          'Paint {{code}}',
                          { code: option.colorCode },
                        )}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <ManagementRawDetails value={data} />
    </div>
  )
}
