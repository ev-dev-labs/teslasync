import { useTranslation } from 'react-i18next';
import { KVList } from '@/components/data-display';
import { PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { RenewalReview } from '@/types/subscriptionRenewal';
import { formatCurrencyMinor } from '../../formatters';

export function SubscriptionRenewalEvidence({ review }: { review: RenewalReview }) {
  const { t } = useTranslation();
  const { formatDayKey, formatDateTime } = useDateFormat();
  const { fmtInt } = useNumberFormatting();
  const units = useUnits();
  const e = review.evidence;
  const observed = e.quantity != null && e.coverage === 'observed_only';
  const label = e.metric === 'driving_distance' ? t('ownership.subscription.metric.driving_distance', 'Driving distance')
    : e.metric === 'drive_count' ? t('ownership.subscription.metric.drive_count', 'Drive count')
      : t('ownership.subscription.metric.charging_sessions', 'Charging sessions');
  return <div className="space-y-3">
    <PanelTitle>{t('ownership.subscription.renewal.ready', 'Review the recorded subscription renewal')}</PanelTitle>
    <KVList items={[
      { label: t('ownership.subscription.row.name', 'Subscription'), value: review.name },
      { label: t('ownership.subscription.renewal.date', 'Recorded renewal date'), value: formatDayKey(review.renewal_day) },
      { label: t('ownership.subscription.renewal.price', 'Recorded price per billing period'),
        value: `${formatCurrencyMinor(review.price_minor, review.currency, units.unitPrefs.locale)} ${review.currency}` },
      { label: t('ownership.subscription.renewal.cadence', 'Billing cadence'),
        value: review.billing_period === 'annual' ? t('ownership.subscription.billing.annual', 'Annual') : t('ownership.subscription.billing.monthly', 'Monthly') },
      ...(observed ? [{ label, value: e.metric === 'driving_distance' ? units.formatDistance(e.quantity) : fmtInt(e.quantity) }] : []),
    ]} />
    {observed
      ? <Text as="p" variant="caption">{t('ownership.subscription.renewal.coverage', 'Recorded on {{days}} days from {{from}} up to {{through}}. Missing records are not zero usage.', {
        days: fmtInt(e.observed_days), from: formatDateTime(e.from), through: formatDateTime(e.through),
      })}</Text>
      : <Text as="p" variant="caption">{e.coverage === 'not_measured'
        ? t('ownership.subscription.renewal.unsupported', 'This subscription’s usage is not measured by the available records.')
        : t('ownership.subscription.renewal.noEvidence', 'There is not enough reliable recorded usage to display a total.')}</Text>}
    {e.excluded > 0 && <Text as="p" variant="caption">{t('ownership.subscription.renewal.excluded', 'Excluded {{count}} drives without a valid measured distance.', { count: e.excluded })}</Text>}
    <Text as="p" variant="bodySm">{t('ownership.subscription.renewal.why', 'Why this? You confirmed the renewal date. The recorded activity does not prove that the subscription caused it. Check the provider’s terms before deciding; TeslaSync does not cancel or renew anything.')}</Text>
  </div>;
}
