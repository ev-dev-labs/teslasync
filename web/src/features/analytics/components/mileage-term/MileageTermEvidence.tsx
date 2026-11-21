import { useTranslation } from 'react-i18next';
import { KVList } from '@/components/data-display';
import { PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { MileageTermDigest, MileageTermSettings } from '@/types/mileageTerm';

export function MileageTermEvidence({ digest, settings }: { digest: MileageTermDigest; settings: MileageTermSettings }) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const { formatDateTime, formatDayKey } = useDateFormat();
  const p = digest.projection;
  const zone = { tz: settings.time_zone };
  const range = (lower: number, upper: number) => t('mileageBudget.review.range', '{{lower}} to {{upper}}', {
    lower: formatDistance(lower), upper: formatDistance(upper),
  });
  return <div className="space-y-3">
    <PanelTitle>{t('mileageBudget.review.finding', 'Projected distance exceeds this allowance')}</PanelTitle>
    <KVList items={[
      { label: t('mileageBudget.review.period', 'Entered term (end excluded)'), value: t('mileageBudget.review.range', '{{lower}} to {{upper}}', {
        lower: formatDayKey(settings.first_day), upper: formatDayKey(settings.end_day),
      }) },
      { label: t('mileageBudget.review.observed', 'Odometer distance used'), value: formatDistance(p.used_m) },
      { label: t('mileageBudget.review.allowedSoFar', 'Pro-rated allowance at that reading'), value: formatDistance(p.allowed_to_date_m) },
      { label: t('mileageBudget.review.allowance', 'Distance allowed over the entire term'), value: formatDistance(settings.allowance_m) },
      { label: t('mileageBudget.review.projected', 'Estimated end-of-term distance'), value: range(p.lower_m, p.upper_m) },
      { label: t('mileageBudget.review.overage', 'Estimated distance over the allowance'),
        value: range(p.lower_m - settings.allowance_m, p.upper_m - settings.allowance_m) },
    ]} />
    <Text as="p" variant="caption">
      {t('mileageBudget.review.why', 'Why this? Even the slower pace exceeds your threshold. The range uses {{count}} days with odometer readings, from {{from}} to {{to}}, and your entered opening odometer.', {
        count: p.observed_days, from: formatDateTime(p.evidence_from, zone), to: formatDateTime(p.observed_at, zone),
      })}
    </Text>
    <Text as="p" variant="caption">
      {t('mileageBudget.review.limits', 'This estimates total vehicle distance, not reimbursable distance or any penalty. Changes in driving can change the result.')}
    </Text>
  </div>;
}
