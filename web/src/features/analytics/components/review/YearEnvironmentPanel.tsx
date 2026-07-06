import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Leaf } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import { safeNumber } from '@/lib/numberFormat';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
}

const MAX_TREES = 30;
// A mature tree sequesters roughly 21 kg of CO₂ per year — the divisor that
// turns the year's offset into an intuitive "trees planted" equivalent.
const KG_CO2_PER_TREE = 21;

/** CO₂ offset for the year, visualised as an equivalent number of trees. */
export function YearEnvironmentPanel({ data }: Props) {
  const { t } = useTranslation();

  // safeNumber() coerces null / undefined / NaN / Infinity from a lying API to
  // 0 so the arithmetic below can never produce NaN and blank out the panel.
  const co2 = safeNumber(data.co2_offset_kg);
  const trees = useMemo(
    () => Math.max(0, Math.round(co2 / KG_CO2_PER_TREE)),
    [co2],
  );
  const treeIcons = useMemo(
    () => Array.from({ length: Math.min(trees, MAX_TREES) }, (_, i) => i),
    [trees],
  );

  return (
    <GlassPanel className="flex h-full flex-col gap-4 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neon-green/10 ring-1 ring-neon-green/20">
          <Leaf className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        </span>
        <PanelTitle>{t('yearReview.co2Offset', 'CO₂ offset')}</PanelTitle>
      </div>

      <div>
        <AnimatedNumber
          value={co2}
          duration={1.2}
          suffix=" kg"
          className="text-4xl font-bold tracking-tight text-emerald-300 sm:text-5xl"
        />
        <Caption className="mt-1 block">
          {t('yearReview.treesEquiv', { count: trees, defaultValue: 'Like planting {{count}} trees' })}
        </Caption>
      </div>

      <div className="mt-auto flex flex-wrap gap-1.5">
        {treeIcons.map((i) => (
          <Text as="span" key={i} size="xl" className="leading-none" aria-hidden="true">🌳</Text>
        ))}
        {trees > MAX_TREES && (
          <Text variant="bodySm" className="self-end">
            +{trees - MAX_TREES} {t('yearReview.more', 'more')}
          </Text>
        )}
        {trees === 0 && (
          <Caption>{t('yearReview.noTrees', 'Every trip helps — keep driving electric!')}</Caption>
        )}
      </div>
    </GlassPanel>
  );
}
