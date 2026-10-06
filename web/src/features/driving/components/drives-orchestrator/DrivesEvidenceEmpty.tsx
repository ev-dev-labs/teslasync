import { Route } from 'lucide-react';
import { EmptyState, EmptyStateGuidanceDetails } from '@/components/feedback';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController, 'collection' | 'fsdFilter' | 'hasValueFilters' | 't' | 'setUrlBatch'>;

export function DrivesEvidenceEmpty({ collection, fsdFilter, hasValueFilters, t, setUrlBatch }: Props) {
  return (
    <>
      <EmptyState
        icon={<Route className="h-8 w-8" />}
        title={
          collection !== 'all' || fsdFilter !== 'all' || hasValueFilters
            ? t('drives.emptyForCollection', 'No drives in this view')
            : t('drives.emptyTitle', 'No drives recorded yet')
        }
        message={
          collection !== 'all' || fsdFilter !== 'all' || hasValueFilters
            ? t('drives.emptyForCollection.msg', 'Try switching to a different collection or clearing your filters.')
            : t('drives.emptyMessage', 'Drive data will appear here once your vehicle records trips.')
        }
        action={{
          label: t('drives.empty.cta', 'Reset filters'),
          onClick: () => {
            setUrlBatch({
              q: null,
              from: null,
              to: null,
              coll: null,
              fsd: null,
              grid_values: null,
              sort: null,
              page: null,
            });
          },
        }}
      />
      {/* HELP-02. Only for the unfiltered view: the governed "likely
          cause" describes a vehicle that has not driven since it was
          linked, which would be wrong copy for a user who has simply
          filtered every row out — that case is already answered by the
          message above. One CTA is preserved; this adds explanation,
          not another action. */}
      {collection === 'all' && !hasValueFilters && (
        <EmptyStateGuidanceDetails guidanceId="drives.list" className="mx-auto" />
      )}
    </>
  );
}
