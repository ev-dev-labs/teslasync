import { PillFilterBar } from '@/components/forms';
import { FadeIn } from '@/components/motion';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController, 'filterPills' | 'activeFilterKey' | 'setUrlBatch' | 't'>;

export function DrivesCollectionFilters({ filterPills, activeFilterKey, setUrlBatch, t }: Props) {
  return (
    <FadeIn>
      <PillFilterBar
        items={filterPills}
        semanticMode="filters"
        activeKey={activeFilterKey}
        onChange={(key) => {
          if (key === 'combined') return;
          setUrlBatch({
            coll: key.startsWith('coll:') ? key.slice(5) : null,
            fsd: key.startsWith('fsd:') ? key.slice(4) : null,
            page: null,
          });
        }}
        ariaLabel={`${t('drives.collections.aria', 'Filter drives by collection')} · ${t('drives.fsdFilter.aria', 'Filter drives by FSD evidence')}`}
        testId="drives-filters"
        className="py-1 [&_[aria-pressed]]:h-11 sm:[&_[aria-pressed]]:h-9 sm:[&_[aria-pressed]]:px-2"
      />
    </FadeIn>
  );
}
