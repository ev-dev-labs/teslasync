import { InlineCallout } from '@/components/feedback';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  'valueFilter' | 'desktopEvidence' | 'hasValueFilters' | 't' | 'setUrlBatch'>;

export function DrivesEvidenceNotices({
  valueFilter, desktopEvidence, hasValueFilters, t, setUrlBatch,
}: Props) {
  if (!valueFilter.invalid && (desktopEvidence || !hasValueFilters)) return null;
  return (
    <InlineCallout
      variant={valueFilter.invalid ? 'warning' : 'info'}
      action={{ label: t('table.filter.clear', 'Clear'), onClick: () => setUrlBatch({ grid_values: null, page: null }) }}
    >
      {valueFilter.invalid
        ? t('table.filter.invalidValues', 'This saved value filter is invalid. Clear it to reset.')
        : t('table.filter.mobileValues', 'Column value filters are active. Open the desktop grid to edit them, or clear them here.')}
    </InlineCallout>
  );
}
