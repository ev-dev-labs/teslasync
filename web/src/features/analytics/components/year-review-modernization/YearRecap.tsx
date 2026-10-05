import { useTranslation } from 'react-i18next';
import { StatGroup } from '@/components/data-display/stat-reference';
import { Heading, Text, Caption, HelperText } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { safeNumber } from '@/lib/numberFormat';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { StatPeriod } from '@/lib/metric-reference';
import type { YearReview } from '@/api/types';

/** Screenshot/share guidance is preserved; the original had no download button. */
export function YearRecap({ data, period }: { data: YearReview; period: StatPeriod }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const { fmtInt } = useNumberFormatting();
  const distanceUnit = unitPrefs.distance;
  const gasSavings = safeNumber(data.gas_savings);
  // Original AnimatedNumber used integer display here. Keep that contract
  // independently from the more precise highlights above.
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div>
          <Heading level="sub">{data.year}</Heading>
          <Caption>{t('yearReview.title', 'Year in review')}</Caption>
        </div>
        <div className="min-w-0">
          <Text as="p" variant="body" className="break-words">{data.vehicle?.display_name ?? '—'}</Text>
          <Caption className="break-words">{data.vehicle?.model ?? ''}</Caption>
        </div>
      </div>
      <StatGroup id="year-review-recap" period={period} metrics={[
        { metricId: 'count', rawValue: safeNumber(data.total_drives), label: t('yearReview.totalDrives', 'Drives') },
        { metricId: 'text', rawValue: fmtInt(convertDistanceFromSI(safeNumber(data.total_distance_km) * 1000, distanceUnit)), label: distanceUnit },
        { metricId: 'text', rawValue: fmtInt(safeNumber(data.total_energy_kwh)), label: t('yearReview.energyKwh', 'kWh') },
        { metricId: 'count', rawValue: safeNumber(data.total_charge_sessions), label: t('yearReview.charges', 'Charges') },
        { metricId: 'text', rawValue: fmtInt(safeNumber(data.co2_offset_kg)), label: t('yearReview.co2KgSaved', 'kg CO₂ saved') },
      ]} />
      {gasSavings > 0 && <Text as="p" variant="bodySm">
        {t('yearReview.savedSummary', { amount: formatCurrency(gasSavings), defaultValue: 'Saved {{amount}} vs. gas' })}
      </Text>}
      <HelperText>{t('yearReview.screenshot', 'Screenshot to share your year')}</HelperText>
    </>
  );
}
