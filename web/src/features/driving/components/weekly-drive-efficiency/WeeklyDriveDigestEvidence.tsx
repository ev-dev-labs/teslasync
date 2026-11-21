import { useTranslation } from 'react-i18next';
import { KVList } from '@/components/data-display';
import { Button, PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { formatEnergyPerDistance } from '@/lib/unitConversion';
import type { WeeklyDriveDigest } from '@/types/weeklyDriveEfficiency';

interface Props {
  digest: WeeklyDriveDigest;
  timeZone: string;
  canOpenDrive: boolean;
  onOpenDrive: () => void;
}

export function WeeklyDriveDigestEvidence({ digest, timeZone, canOpenDrive, onOpenDrive }: Props) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat('user');
  const { fmtInt } = useNumberFormatting();
  const { unitPrefs } = useUnits();
  const bound = (n: number) => formatEnergyPerDistance(n, unitPrefs, { precision: 0 });
  const range = ({ low_wh_per_m: low, high_wh_per_m: high }: WeeklyDriveDigest['recent']) =>
    t('routeEfficiency.weekly.range', '{{low}} to {{high}}', { low: bound(low), high: bound(high) });
  return <div className="space-y-3">
    <PanelTitle>{digest.higher
      ? t('routeEfficiency.weekly.higher', 'Higher consumption on matched drives')
      : t('routeEfficiency.weekly.lower', 'Lower consumption on matched drives')}</PanelTitle>
    <KVList items={[
      { label: t('routeEfficiency.weekly.baseline', 'Earlier matched drives'), value: range(digest.baseline) },
      { label: t('routeEfficiency.weekly.recent', 'Last week’s matched drives'), value: range(digest.recent) },
      { label: t('routeEfficiency.weekly.last', 'Latest matching drive ended'), value: formatDateTime(digest.observed_until, { tz: timeZone }) },
    ]} />
    <Text as="p" variant="caption">{t('routeEfficiency.weekly.coverage', '{{recent}} observed days last week, compared with {{baseline}} earlier days. Review uses the saved time zone, not the page date range.', {
      recent: fmtInt(digest.recent_days), baseline: fmtInt(digest.baseline_days),
    })}</Text>
    <Text as="p" variant="bodySm">{t('routeEfficiency.weekly.why', 'Why this? Recorded routes, outside temperatures and average trip speeds were similar. Measured pack consumption changed in both parts of the week. This is not a diagnosis or a driver score.')}</Text>
    <Button type="button" className="min-h-11" variant="secondary" wrapLabel disabled={!canOpenDrive} onClick={onOpenDrive}>
      {t('routeEfficiency.weekly.drive', 'Open latest matching drive')}
    </Button>
  </div>;
}
