import { useTranslation } from 'react-i18next';
import { SearchInput, FilterBar, PillFilterBar, ActiveFilterChips } from '@/components/forms';
import { useActiveFilterChips, type ChipConfigRecord } from '@/hooks/useActiveFilterChips';
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

  const cameraPills = buildCameraPills(clips, allLabel);
  const sourcePills = buildSourcePills(clips, allLabel);
  const eventTypePills = buildEventTypePills(clips, allLabel);

  const pillLabel = (
    items: ReadonlyArray<{ key: string; label: string }>,
    key: string,
  ): string => items.find((item) => item.key === key)?.label ?? key;

  // `'all'` is this page's "no filter applied" sentinel rather than an empty
  // string, so every facet needs an explicit isEmpty override.
  const chipConfig: ChipConfigRecord = {
    query: {
      label: t('dashcam.filters.searchLabel', 'Search'),
      setter: () => onChange({ ...filters, query: '' }),
    },
    camera: {
      label: t('dashcam.filters.camera', 'Camera'),
      format: (value) => pillLabel(cameraPills, String(value)),
      isEmpty: (value) => value === 'all',
      setter: () => onChange({ ...filters, camera: 'all' }),
    },
    source: {
      label: t('dashcam.filters.source', 'Source folder'),
      format: (value) => pillLabel(sourcePills, String(value)),
      isEmpty: (value) => value === 'all',
      setter: () => onChange({ ...filters, source: 'all' }),
    },
    eventType: {
      label: t('dashcam.filters.eventType', 'Event type'),
      format: (value) => pillLabel(eventTypePills, String(value)),
      isEmpty: (value) => value === 'all',
      setter: () => onChange({ ...filters, eventType: 'all' }),
    },
  } as ChipConfigRecord;

  const chips = useActiveFilterChips(chipConfig, filters as unknown as Record<string, unknown>);

  return (
    <>
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
            items={cameraPills}
            activeKey={filters.camera}
            onChange={(key) => onChange({ ...filters, camera: key as ClipFilterState['camera'] })}
          />
          <PillFilterBar
            ariaLabel={t('dashcam.filters.source', 'Source folder')}
            items={sourcePills}
            activeKey={filters.source}
            onChange={(key) => onChange({ ...filters, source: key as ClipFilterState['source'] })}
          />
          <PillFilterBar
            ariaLabel={t('dashcam.filters.eventType', 'Event type')}
            items={eventTypePills}
            activeKey={filters.eventType}
            onChange={(key) => onChange({ ...filters, eventType: key as ClipFilterState['eventType'] })}
          />
        </div>
      </FilterBar>
      <ActiveFilterChips
        filters={chips}
        onClearAll={() =>
          onChange({ query: '', camera: 'all', source: 'all', eventType: 'all' })
        }
      />
    </>
  );
}
