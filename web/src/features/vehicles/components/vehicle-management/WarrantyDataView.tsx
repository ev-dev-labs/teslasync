import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/feedback'
import { Badge, Code, Heading, Text } from '@/components/ui'
import { formatDate } from '@/lib/dateFormat'
import { Icons } from '@/lib/icons'
import { fmtInt } from '@/lib/numberFormat'
import {
  parseWarrantyDetails,
  type WarrantyCoverageData,
  type WarrantyCoverageState,
} from './managementData'
import { ManagementRawDetails } from './ManagementRawDetails'

interface WarrantyDataViewProps {
  data: unknown
}

const stateVariant = {
  active: 'success',
  upcoming: 'info',
  expired: 'neutral',
} as const

function coverageIcon(state: WarrantyCoverageState) {
  if (state === 'active') return Icons.securityCheck
  if (state === 'upcoming') return Icons.calendarClock
  return Icons.history
}

function CoverageCard({ coverage }: { coverage: WarrantyCoverageData }) {
  const { t } = useTranslation()
  const CoverageIcon = coverageIcon(coverage.state)
  const stateLabel = {
    active: t('vehicleManagement.warranty.active', 'Active'),
    upcoming: t('vehicleManagement.warranty.upcoming', 'Upcoming'),
    expired: t('vehicleManagement.warranty.expired', 'Expired'),
  }[coverage.state]
  const coverageTerm =
    coverage.coverageAgeYears != null
      ? t('vehicleManagement.warranty.years', '{{count}} years', {
          count: coverage.coverageAgeYears,
        })
      : coverage.coverageAgeMonths != null
        ? t('vehicleManagement.warranty.months', '{{count}} months', {
            count: coverage.coverageAgeMonths,
          })
        : t('vehicleManagement.warranty.notProvided', 'Not provided')

  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-violet-500/10 p-2 text-violet-300">
            <CoverageIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <Heading level="sub" as="h4">
              {coverage.displayName ??
                t(
                  'vehicleManagement.warranty.unnamedCoverage',
                  'Warranty coverage',
                )}
            </Heading>
            {coverage.code && <Code>{coverage.code}</Code>}
          </div>
        </div>
        <Badge variant={stateVariant[coverage.state]} dot>
          {stateLabel}
        </Badge>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2">
          <dt>
            <Text variant="label">
              {t('vehicleManagement.warranty.coverageTerm', 'Coverage term')}
            </Text>
          </dt>
          <dd>
            <Text variant="body" weight="semibold">
              {coverageTerm}
            </Text>
          </dd>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2">
          <dt>
            <Text variant="label">
              {t(
                'vehicleManagement.warranty.odometerLimit',
                'Odometer limit',
              )}
            </Text>
          </dt>
          <dd>
            <Text variant="body" weight="semibold" mono>
              {coverage.expirationOdometer != null
                ? fmtInt(coverage.expirationOdometer)
                : t('vehicleManagement.warranty.notProvided', 'Not provided')}
            </Text>
          </dd>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2">
          <dt>
            <Text variant="label">
              {t('vehicleManagement.warranty.expiration', 'Expiration')}
            </Text>
          </dt>
          <dd>
            <Text variant="body" weight="semibold">
              {coverage.expirationDate
                ? formatDate(coverage.expirationDate)
                : t('vehicleManagement.warranty.notProvided', 'Not provided')}
            </Text>
          </dd>
        </div>
      </dl>
    </div>
  )
}

export function WarrantyDataView({ data }: WarrantyDataViewProps) {
  const { t } = useTranslation()
  const warranty = parseWarrantyDetails(data)
  const coverages = [
    ...warranty.active,
    ...warranty.upcoming,
    ...warranty.expired,
  ]

  if (coverages.length === 0) {
    return (
      <div>
        <EmptyState
          title={t(
            'vehicleManagement.warranty.emptyTitle',
            'No warranty coverage returned',
          )}
          message={t(
            'vehicleManagement.warranty.emptyDetail',
            'Tesla returned a response, but it did not include active, upcoming, or expired coverage records.',
          )}
          className="py-5"
        />
        <ManagementRawDetails value={data} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant="success">
          {t('vehicleManagement.warranty.activeCount', '{{count}} active', {
            count: warranty.active.length,
          })}
        </Badge>
        <Badge variant="info">
          {t(
            'vehicleManagement.warranty.upcomingCount',
            '{{count}} upcoming',
            { count: warranty.upcoming.length },
          )}
        </Badge>
        <Badge variant="neutral">
          {t('vehicleManagement.warranty.expiredCount', '{{count}} expired', {
            count: warranty.expired.length,
          })}
        </Badge>
      </div>

      <div className="space-y-2">
        {coverages.map((coverage, index) => (
          <CoverageCard
            key={`${coverage.state}-${coverage.code ?? coverage.displayName ?? index}`}
            coverage={coverage}
          />
        ))}
      </div>

      <Text variant="helper" as="p">
        {t(
          'vehicleManagement.warranty.odometerNote',
          'Odometer limits are shown exactly as Tesla reports them because this response does not identify a unit.',
        )}
      </Text>
      <ManagementRawDetails value={data} />
    </div>
  )
}
