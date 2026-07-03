import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Leaf } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { AnimatedNumber } from '@/components/data-display';
import type { YearReview } from '@/api/types';

interface Props {
  data: YearReview;
}

const MAX_TREES = 30;

/** CO₂ offset for the year, visualised as an equivalent number of trees. */
export function YearEnvironmentPanel({ data }: Props) {
  const { t } = useTranslation();

  const co2 = data.co2_offset_kg ?? 0;
  const trees = useMemo(() => Math.round(co2 / 21), [co2]);
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

      <div className="mt-auto flex flex-wrap gap-1.5" aria-hidden="true">
        {treeIcons.map((i) => (
          <span key={i} className="text-xl leading-none">🌳</span>
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
