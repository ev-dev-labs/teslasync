import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/feedback'
import { Badge, Code, Heading, Text } from '@/components/ui'
import { formatDate } from '@/lib/dateFormat'
import { Icons } from '@/lib/icons'

import {
  asManagementRecord,
  parseWarrantyDetails,
  type WarrantyCoverageData,
  type WarrantyCoverageState,
} from './managementData'
import { ManagementRawDetails } from './ManagementRawDetails'
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { OperationalBrief, type StatMetric } from '@/components/data-display'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'

interface WarrantyDataViewProps {
  data: unknown
}

const stateVariant = {
  active: 'success',
  upcoming: 'info',
  expired: 'neutral',
  unknown: 'neutral',
} as const

function coverageIcon(state: WarrantyCoverageState) {
  if (state === 'active') return Icons.securityCheck
  if (state === 'upcoming') return Icons.calendarClock
  if (state === 'unknown') return Icons.helpCircle
  return Icons.history
}

function warrantyGroupCount(
  data: unknown,
  state: 'active' | 'upcoming' | 'expired',
  coverages: readonly WarrantyCoverageData[],
): number | null {
  const record = asManagementRecord(data)
  const keys = [`${state}Warranty`, `${state}_warranty`, `${state}Warranties`, `${state}_warranties`]
  const key = record && keys.find((candidate) => candidate in record)
  const group = record && key ? record[key] : undefined
  if (coverages.length === 0) {
    return Array.isArray(group) && group.length === 0 ? 0 : null
  }
  const recognized = coverages.every((coverage) =>
    Object.entries(coverage).some(([field, value]) => field !== 'state' && value != null),
  )
  return recognized ? coverages.length : null
}

function CoverageCard({ coverage }: { coverage: WarrantyCoverageData }) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation()
  const CoverageIcon = coverageIcon(coverage.state)
  const stateLabel = {
    active: t('vehicleManagement.warranty.active', 'Active'),
    upcoming: t('vehicleManagement.warranty.upcoming', 'Upcoming'),
    expired: t('vehicleManagement.warranty.expired', 'Expired'),
    unknown: t('common.unknown', 'Unknown'),
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
          <div className="rounded-lg bg-[var(--surface-2)] p-2 text-[var(--text-secondary)]">
            <CoverageIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <Heading level="sub" as="h4">
              {coverage.displayName ??
                t('vehicleManagement.warranty.unnamedCoverage', 'Warranty coverage')}
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
              {t('vehicleManagement.warranty.odometerLimit', 'Odometer limit')}
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
    ...(warranty.unknown ?? []),
  ]
  const sourceMetrics: readonly StatMetric[] = ([
    ['active', 'Active', '{{count}} active'],
    ['upcoming', 'Upcoming', '{{count}} upcoming'],
    ['expired', 'Expired', '{{count}} expired'],
  ] as const).map(([state, label, context]) => {
    const count = warrantyGroupCount(data, state, warranty[state])
    return {
      metricId: 'count',
      occurrenceId: state,
      label: t(`vehicleManagement.warranty.${state}`, label),
      rawValue: count,
      context: count == null
        ? t('common.unknown', 'Unknown')
        : t(`vehicleManagement.warranty.${state}Count`, context, { count }),
    }
  })
  const metrics = useOperationalMetrics(sourceMetrics)

  return (
    <div className="space-y-3">
      <OperationalBrief compact testId="vehicle-warranty-counts"
        eyebrow={t('vehicles.evidenceBrief.eyebrow', 'Vehicle evidence')}
        title={t('vehicleManagement.warranty.summaryTitle', 'Returned warranty coverage')}
        description={t('vehicleManagement.warranty.summaryDescription', 'Counts describe the returned coverage records, not a complete warranty history. Individual coverage terms and raw source details remain below.')}
        statusLabel={t('vehicleManagement.warranty.summaryStatus', 'Warranty response returned')}
        scope={t('vehicleManagement.warranty.summaryScope', 'Active, upcoming and expired groups as reported by Tesla; no response observation time supplied.')}
        provenance={t('vehicleManagement.warranty.summarySource', 'Tesla warranty response')}
        metrics={metrics} />

      {coverages.length === 0 ? (
        <EmptyState /* no-action: refresh and management controls are provided by the parent workspace */
          title={t('vehicleManagement.warranty.emptyTitle', 'No warranty coverage returned')}
          message={t('vehicleManagement.warranty.emptyDetail', 'Tesla returned a response, but it did not include active, upcoming, or expired coverage records.')}
          className="py-5"
        />
      ) : <div className="space-y-2">
        {coverages.map((coverage, index) => (
          <CoverageCard
            key={`${coverage.state}-${coverage.code ?? coverage.displayName ?? index}`}
            coverage={coverage}
          />
        ))}
      </div>}

      <Text variant="helper" as="p">
        {t('vehicleManagement.warranty.odometerNote', 'Odometer limits are shown exactly as Tesla reports them because this response does not identify a unit.')}
      </Text>
      <ManagementRawDetails value={data} />
    </div>
  )
}
