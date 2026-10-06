import { FadeIn } from '@/components/motion';
import { TableToolbar, ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  'tableControls' | 'search' | 't' | 'setUrlBatch' | 'collection'
  | 'collectionLabel' | 'fsdFilter' | 'fsdFilterLabel'>;

export function DrivesMobileFilters({
  tableControls, search, t, setUrlBatch, collection, collectionLabel, fsdFilter, fsdFilterLabel,
}: Props) {
  return (
    <FadeIn>
      <TableToolbar {...tableControls} />
      <ActiveFilterChips
        className="mt-3"
        filters={
          ([
            search
              ? {
                  key: 'q',
                  label: t('drives.filterLabel.search', 'Search'),
                  value: search,
                  onRemove: () => { setUrlBatch({ q: null, page: null }); },
                } satisfies FilterChipDescriptor
              : null,
            // Date range chips intentionally omitted — the header range control
            // trigger above already shows the active range and offers
            // preset reset, so showing chips here would duplicate the
            // affordance.
            collection !== 'all'
              ? {
                  key: 'coll',
                  label: t('drives.filterLabel.collection', 'View'),
                  value: collectionLabel,
                  onRemove: () => { setUrlBatch({ coll: null, page: null }); },
                } satisfies FilterChipDescriptor
              : null,
            fsdFilter !== 'all'
              ? {
                  key: 'fsd',
                  label: t('drives.filterLabel.fsd', 'FSD evidence'),
                  value: fsdFilterLabel,
                  onRemove: () => { setUrlBatch({ fsd: null, page: null }); },
                } satisfies FilterChipDescriptor
              : null,
          ].filter(Boolean) as FilterChipDescriptor[]) as readonly FilterChipDescriptor[]
        }
        onClearAll={() => {
          // Only clear filters that are visible as chips. Date range is
          // owned by the header range control, so leave it alone here — clearing
          // an invisible filter would be a WYSIWYG violation.
          setUrlBatch({ q: null, coll: null, fsd: null, page: null });
        }}
      />
    </FadeIn>
  );
}
