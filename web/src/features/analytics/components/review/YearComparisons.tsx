import { useTranslation } from 'react-i18next';

import { GlassPanel, Text, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import type { YearReviewComparison } from '@/api/types';

interface Props {
  comparisons: YearReviewComparison[] | null | undefined;
}

/** Playful "fun facts" tiles comparing the year's stats to relatable things. */
export function YearComparisons({ comparisons }: Props) {
  const { t } = useTranslation();
  const items = comparisons ?? [];

  if (items.length === 0) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <EmptyState message={t('yearReview.noFunFacts', 'No fun facts available for this year yet')} />
      </GlassPanel>
    );
  }

  return (
    <div className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))]">
      {items.map((item) => (
        <GlassPanel key={item.label} className="flex flex-col items-center gap-1 p-4 text-center">
          <span className="text-3xl leading-none" aria-hidden="true">{item.emoji}</span>
          <Text variant="body" className="font-semibold">{item.label}</Text>
          <Caption>{item.value}</Caption>
        </GlassPanel>
      ))}
    </div>
  );
}
