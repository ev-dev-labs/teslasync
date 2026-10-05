import { useTranslation } from 'react-i18next';
import { CardGrid, LayoutCard } from '@/components/layout/layout-reference';
import { Text, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import type { YearReviewComparison } from '@/api/types';

export function YearFunFacts({ comparisons }: { comparisons: YearReviewComparison[] | null | undefined }) {
  const { t } = useTranslation();
  const items = (comparisons ?? []).filter(Boolean);
  const title = t('yearReview.funFacts', 'Fun facts about your year');
  if (items.length === 0) return (
    <LayoutCard title={title}>
      <EmptyState message={t('yearReview.noFunFacts', 'No fun facts available for this year yet')} />
    </LayoutCard>
  );
  return (
    <div role="list" aria-label={title}>
      <CardGrid label={title} items={items.map((item, index) => ({
        id: `${item.label ?? 'fact'}-${index}`, size: 'quarter',
        content: (
          <LayoutCard title={item.label ?? '—'}>
            <div role="listitem" className="min-w-0 space-y-2">
              <Text as="span" size="3xl" aria-hidden="true" className="leading-none">{item.emoji ?? ''}</Text>
              <Caption className="block break-words">{item.value ?? '—'}</Caption>
            </div>
          </LayoutCard>
        ),
      }))} />
    </div>
  );
}
