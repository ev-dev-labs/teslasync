import { useTranslation } from 'react-i18next';
import { StatGroup } from '@/components/data-display/stat-reference';
import { Text, Caption } from '@/components/ui';
import { safeNumber } from '@/lib/numberFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { StatPeriod } from '@/lib/metric-reference';
import type { YearReview } from '@/api/types';

/** Mass has no glossary definition: retain the specialist kg presentation.
 * Do not misclassify CO₂ mass as unclassified numeric energy or distance. */
export function YearEnvironment({ data, period }: { data: YearReview; period: StatPeriod }) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const co2 = safeNumber(data.co2_offset_kg);
  const trees = Math.max(0, Math.round(co2 / 21));
  const treeIcons = Array.from({ length: Math.min(trees, 30) }, (_, i) => i);
  return (
    <>
      <StatGroup id="year-review-environment" period={period} metrics={[
        { metricId: 'text', rawValue: `${fmtInt(co2)} kg`, label: t('yearReview.co2Offset', 'CO₂ offset'),
          description: t('yearReview.treesEquiv', { count: trees, defaultValue: 'Like planting {{count}} trees' }) },
      ]} />
      <Caption>{t('yearReview.treesEquiv', { count: trees, defaultValue: 'Like planting {{count}} trees' })}</Caption>
      <div className="flex flex-wrap gap-1.5">
        {treeIcons.map(i => <Text as="span" key={i} size="xl" className="leading-none" aria-hidden="true">🌳</Text>)}
        {trees > 30 && <Text variant="bodySm" className="self-end">+{trees - 30} {t('yearReview.more', 'more')}</Text>}
        {trees === 0 && <Caption>{t('yearReview.noTrees', 'Every trip helps — keep driving electric!')}</Caption>}
      </div>
    </>
  );
}
