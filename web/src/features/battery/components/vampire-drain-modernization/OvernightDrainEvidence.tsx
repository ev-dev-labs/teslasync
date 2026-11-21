import { useTranslation } from 'react-i18next';
import { Button, PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { OvernightDrainReview } from '@/types/overnightDrain';

const ns = 'vampireDrain.overnight';

export function OvernightDrainEvidence({ review, zone, writable, dismiss }: {
  review: OvernightDrainReview;
  zone: string;
  writable: boolean;
  dismiss: () => void;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { fmtNumber } = useNumberFormatting();
  const formatAt = (at: string) => formatDateTime(at, { tz: zone });
  const labels = {
    sentry: t(`${ns}.sentry`, 'Sentry reported armed or active'),
    climate: t(`${ns}.climate`, 'Cabin climate or protection reported on'),
    wake_requested: t(`${ns}.wake`, 'Wake request recorded (not a confirmed wake)'),
  };
  return (
    <div className="space-y-2">
      <PanelTitle>{t(`${ns}.above`, 'More battery drain than usual last night')}</PanelTitle>
      <Text as="p" variant="bodySm">{t(`${ns}.summary_other`, 'Battery charge fell {{loss}} percentage points. The middle half of {{count}} comparable nights was {{low}}–{{high}} points over the same duration.', {
        loss: fmtNumber(review.measured_loss_pct, 1),
        count: review.comparable_nights,
        low: fmtNumber(review.typical_loss_low_pct, 1),
        high: fmtNumber(review.typical_loss_high_pct, 1),
      })}</Text>
      <Text as="p" variant="bodySm">{t(`${ns}.window`, 'Measured from {{start}} to {{end}} ({{zone}}). This review expires at {{expiry}}.', {
        start: formatAt(review.start_at), end: formatAt(review.end_at), zone, expiry: formatAt(review.expires_at),
      })}</Text>
      <Text as="p" variant="bodySm">{t(`${ns}.why`, 'Why this? Similar nights had comparable starting charge and outside temperatures. These observations coincided with the loss; they do not prove what caused it. No report does not mean a feature was off.')}</Text>
      <ul className="list-disc space-y-1 ps-5">
        {(review.factors ?? []).map(factor => <li key={factor.kind}><Text variant="bodySm">{t(`${ns}.factor`, '{{factor}} at {{time}}', {
          factor: labels[factor.kind], time: formatAt(factor.observed_at),
        })}</Text></li>)}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <a href="#vampire-drain-sessions" className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2">
          {t(`${ns}.sessions`, 'Compare with your drain sessions')}
        </a>
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={!writable} onClick={dismiss}>
          {t(`${ns}.dismiss`, 'Dismiss this morning’s review')}
        </Button>
      </div>
    </div>
  );
}
