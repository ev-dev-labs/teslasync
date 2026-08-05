import { useTranslation } from 'react-i18next';
import { SearchInput, FilterBar, PillFilterBar } from '@/components/forms';
import type { ClipRecord } from '../../lib/types';
import type { ClipFilterState } from '../../lib/clipFilter';
import { buildCameraPills, buildEventTypePills, buildSourcePills } from './helpers';

export interface ClipFilterBarProps {
  clips: ClipRecord[];
  filters: ClipFilterState;
  onChange: (next: ClipFilterState) => void;
}

/** Search + camera/source/event-type facet filters for the local clip catalog. */
export function ClipFilterBar({ clips, filters, onChange }: ClipFilterBarProps) {
  const { t } = useTranslation();
  const allLabel = t('dashcam.filters.all', 'All');

  return (
    <FilterBar ariaLabel={t('dashcam.filters.ariaLabel', 'Clip filters')} className="flex-col items-stretch gap-3">
      <SearchInput
        value={filters.query}
        onChange={(query) => onChange({ ...filters, query })}
        placeholder={t('dashcam.filters.searchPlaceholder', 'Search filename or notes…')}
        historyScope="dashcam"
      />
      <div className="space-y-2">
        <PillFilterBar
          ariaLabel={t('dashcam.filters.camera', 'Camera')}
          items={buildCameraPills(clips, allLabel)}
          activeKey={filters.camera}
          onChange={(key) => onChange({ ...filters, camera: key as ClipFilterState['camera'] })}
        />
        <PillFilterBar
          ariaLabel={t('dashcam.filters.source', 'Source folder')}
          items={buildSourcePills(clips, allLabel)}
          activeKey={filters.source}
          onChange={(key) => onChange({ ...filters, source: key as ClipFilterState['source'] })}
        />
        <PillFilterBar
          ariaLabel={t('dashcam.filters.eventType', 'Event type')}
          items={buildEventTypePills(clips, allLabel)}
          activeKey={filters.eventType}
          onChange={(key) => onChange({ ...filters, eventType: key as ClipFilterState['eventType'] })}
        />
      </div>
    </FilterBar>
  );
}
