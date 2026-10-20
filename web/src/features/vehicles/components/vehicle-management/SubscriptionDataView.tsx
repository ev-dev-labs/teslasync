import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/feedback'
import { Badge, Code, Heading, Text } from '@/components/ui'
import { useNumberFormatting } from '@/hooks/useNumberFormatting'
import { formatCurrencyValue } from '@/lib/currencyFormat'
import { Icons } from '@/lib/icons'
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat'
import {
  humanizeManagementLabel,
  parseSubscriptionEligibility,
  type SubscriptionBillingData,
} from './managementData'
import { ManagementRawDetails } from './ManagementRawDetails'

interface SubscriptionDataViewProps {
  data: unknown
}

function formatReportedMoney(
  value: number | null,
  currency: string | null,
  precision: number,
  locale: string,
): string {
  if (!isFiniteNumber(value)) return '—'
  const digits = Math.max(2, precision)
  if (!currency) {
    return fmtNumber(value, digits, locale)
  }
  return formatCurrencyValue(
    value,
    currency,
    locale,
    digits,
    { useGrouping: true },
  )
}

function BillingOption({ option }: { option: SubscriptionBillingData }) {
  const { t } = useTranslation()
  const { precision, locale } = useNumberFormatting()
  const periodKey = option.billingPeriod?.trim().toUpperCase()
  const period = {
    DAILY: t('vehicleManagement.subscriptions.period.day', 'day'),
    WEEKLY: t('vehicleManagement.subscriptions.period.week', 'week'),
    MONTHLY: t('vehicleManagement.subscriptions.period.month', 'month'),
    YEARLY: t('vehicleManagement.subscriptions.period.year', 'year'),
    ANNUAL: t('vehicleManagement.subscriptions.period.year', 'year'),
    ONE_TIME: t('vehicleManagement.subscriptions.period.oneTime', 'one time'),
  }[periodKey ?? '']

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
      <Text variant="label" as="p">
        {option.billingPeriod
          ? humanizeManagementLabel(option.billingPeriod)
          : t('vehicleManagement.subscriptions.billingOption', 'Billing option')}
      </Text>
      <Text variant="metricValue" as="p" className="mt-1">
        {formatReportedMoney(option.price, option.currencyCode, precision, locale)}
        {period && (
          <Text variant="bodySm">
            {t('vehicleManagement.subscriptions.perPeriod', ' / {{period}}', {
              period,
            })}
          </Text>
        )}
      </Text>
      {option.total != null && (
        <Text variant="helper" as="p" className="mt-1">
          {t('vehicleManagement.subscriptions.total', 'Total {{amount}}', {
            amount: formatReportedMoney(option.total, option.currencyCode, precision, locale),
          })}
        </Text>
      )}
    </div>
  )
}

export function SubscriptionDataView({
  data,
}: SubscriptionDataViewProps) {
  const { t } = useTranslation()
  const eligibility = parseSubscriptionEligibility(data)

  if (eligibility.offers.length === 0) {
    return (
      <div>
        <EmptyState /* no-action: refresh and management controls are provided by the parent workspace */
          title={t(
            'vehicleManagement.subscriptions.emptyTitle',
            'No eligible subscriptions returned',
          )}
          message={t(
            'vehicleManagement.subscriptions.emptyDetail',
            'Tesla returned a response, but it did not include any eligible subscription offers.',
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
            'vehicleManagement.subscriptions.resultSummary',
            '{{count}} eligible subscription offers',
            { count: eligibility.offers.length },
          )}
        </Text>
        {eligibility.country && (
          <Badge variant="info">
            {t('vehicleManagement.subscriptions.market', 'Market {{country}}', {
              country: eligibility.country,
            })}
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {eligibility.offers.map((offer, index) => (
          <div
            key={`${offer.optionCode ?? offer.product ?? index}`}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <div className="rounded-lg bg-[var(--surface-1)] p-2 text-[var(--text-secondary)]">
                  <Icons.receipt className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-1">
                  <Heading level="sub" as="h4">
                    {offer.product
                      ? humanizeManagementLabel(offer.product)
                      : t(
                          'vehicleManagement.subscriptions.unnamedOffer',
                          'Tesla subscription',
                        )}
                  </Heading>
                  {offer.optionCode && <Code>{offer.optionCode}</Code>}
                </div>
              </div>
              <Badge variant="success" dot>
                {t('vehicleManagement.subscriptions.eligible', 'Eligible')}
              </Badge>
            </div>

            {offer.billingOptions.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {offer.billingOptions.map((option, billingIndex) => (
                  <BillingOption
                    key={`${option.currencyCode ?? 'currency'}-${option.billingPeriod ?? billingIndex}`}
                    option={option}
                  />
                ))}
              </div>
            ) : (
              <Text variant="helper" as="p" className="mt-3">
                {t(
                  'vehicleManagement.subscriptions.noBilling',
                  'Tesla returned no billing options for this offer.',
                )}
              </Text>
            )}
          </div>
        ))}
      </div>

      <ManagementRawDetails value={data} />
    </div>
  )
}
