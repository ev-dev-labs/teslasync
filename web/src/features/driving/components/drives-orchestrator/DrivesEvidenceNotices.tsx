import { AlertTriangle } from 'lucide-react';
import { InlineCallout } from '@/components/feedback';
import { DRIVES_FETCH_LIMIT } from './drivesListConstants';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  'valueFilter' | 'desktopEvidence' | 'hasValueFilters' | 't' | 'setUrlBatch' | 'truncated'>;

export function DrivesEvidenceNotices({
  valueFilter, desktopEvidence, hasValueFilters, t, setUrlBatch, truncated,
}: Props) {
  return (
    <>
      {(valueFilter.invalid || (!desktopEvidence && hasValueFilters)) && (
        <InlineCallout
          variant={valueFilter.invalid ? 'warning' : 'info'}
          action={{ label: t('table.filter.clear', 'Clear'), onClick: () => setUrlBatch({ grid_values: null, page: null }) }}
        >
          {valueFilter.invalid
            ? t('table.filter.invalidValues', 'This saved value filter is invalid. Clear it to reset.')
            : t('table.filter.mobileValues', 'Column value filters are active. Open the desktop grid to edit them, or clear them here.')}
        </InlineCallout>
      )}
      {truncated && (
        <InlineCallout variant="warning" icon={<AlertTriangle className="h-4 w-4" />}>
          {t(
            'drives.truncated',
            'Showing the {{limit}} most recent drives in this range — the range holds more than one request can return. Narrow the dates, or use the CSV/JSON export for the full set.',
            { limit: DRIVES_FETCH_LIMIT },
          )}
        </InlineCallout>
      )}
    </>
  );
}
