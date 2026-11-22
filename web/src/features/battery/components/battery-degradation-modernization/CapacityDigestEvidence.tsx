import { useTranslation } from 'react-i18next';
import { Button, PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';
import { useUnits } from '@/hooks/useUnits';
import type { CapacityDigest, CapacityRange } from '@/types/capacityDigest';

export function CapacityDigestEvidence({ digest, zone, writable, dismiss }: {
  digest: CapacityDigest;
  zone: string;
  writable: boolean;
  dismiss: () => void;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { formatMonthYear } = useDateLabels();
  const { formatEnergy } = useUnits();
  const energyRange = (range: CapacityRange) => t('battery.degradation.capacityDigest.range', '{{low}} to {{high}}', {
    low: formatEnergy(range.low_wh, { precision: 1 }), high: formatEnergy(range.high_wh, { precision: 1 }),
  });
  return (
    <div className="space-y-2">
      <PanelTitle>{t('battery.degradation.capacityDigest.changed', 'Estimated usable battery energy changed')}</PanelTitle>
      <Text as="p" variant="bodySm">{t('battery.degradation.capacityDigest.overall', 'Estimated change: {{range}}.', { range: energyRange(digest.change) })}</Text>
      <ul className="list-disc space-y-1 ps-5">
        {([
          [digest.baseline_from, digest.baseline, digest.baseline_days],
          [digest.recent_from, digest.recent, digest.recent_days],
        ] as const).map(([time, range, count]) => <li key={time}><Text variant="bodySm">
          {t('battery.degradation.capacityDigest.sample', '{{month}}: {{range}} from {{count}} comparable charge days.', {
            month: formatMonthYear(time, { tz: zone }), range: energyRange(range), count,
          })}
        </Text></li>)}
      </ul>
      <Text as="p" variant="bodySm">{t('battery.degradation.capacityDigest.why', 'Why this? Both halves of the latest month shifted beyond the previous range. The estimate uses energy added at the battery and the change in charge at similar pack temperatures and AC power. It is not a capacity test or diagnosis; losses and battery calibration can affect it.')}</Text>
      <Text as="p" variant="bodySm">{t('battery.degradation.capacityDigest.coverage', 'Latest observation: {{observed}}. This digest expires {{expiry}} ({{zone}}).', {
        observed: formatDateTime(digest.observed_to, { tz: zone }), expiry: formatDateTime(digest.expires_at, { tz: zone }), zone,
      })}</Text>
      <div className="flex flex-wrap items-center gap-2">
        <a href="#battery-degradation-history" className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2">
          {t('battery.degradation.capacityDigest.history', 'Review degradation history')}
        </a>
        <Button type="button" className="min-h-11" variant="ghost" wrapLabel disabled={!writable} onClick={dismiss}>
          {t('battery.degradation.capacityDigest.dismiss', 'Dismiss this month’s digest')}
        </Button>
      </div>
    </div>
  );
}
