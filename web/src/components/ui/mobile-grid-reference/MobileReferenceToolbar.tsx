import { useTranslation } from 'react-i18next';
import { Input, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { showMobileSearch } from './helpers';
import type { MobileGridCallbacks, MobileGridModel } from './types';

interface Props { model: MobileGridModel; callbacks: MobileGridCallbacks }
export function MobileReferenceToolbar({ model, callbacks }: Props) {
  const { t } = useTranslation();
  return (
    <div className="mb-2 space-y-2">
      <div className="mgr-toolbar flex min-w-0 items-center gap-2">
        {showMobileSearch(model.maximumRows) && (
          <div data-grid-search="" className="mgr-search min-w-0 flex-1">
            <Input type="search" value={model.query} onChange={event => callbacks.onSearch(event.target.value)}
              aria-label={t('developerReference.mobileGrid.toolbar.searchLabel', 'Search {{label}}', { label: model.label })}
              placeholder={t('developerReference.mobileGrid.toolbar.search', 'Search…')} />
          </div>
        )}
        {model.sortOptions.length > 1 && (
          <Button data-grid-sort="" variant="secondary" className="mgr-control"
            aria-haspopup="dialog" aria-expanded={model.overlays.sort} onClick={() => callbacks.onOverlay('sort', true)}>
            {t('developerReference.mobileGrid.toolbar.sort', 'Sort')}
          </Button>
        )}
        <Button variant="secondary" className="mgr-control ml-auto !px-3" aria-haspopup="dialog"
          aria-expanded={model.overlays.overflow}
          aria-label={t('developerReference.mobileGrid.toolbar.more', 'More grid actions')}
          onClick={() => callbacks.onOverlay('overflow', true)}>
          <span aria-hidden="true">⋯</span>
        </Button>
      </div>
      {model.filters.length > 0 && (
        <div data-grid-chips="" className="flex gap-2 overflow-x-auto pb-1">
          {model.filters.map(filter => (
            <Button key={filter.key} data-grid-chip="" variant="ghost"
              aria-pressed={filter.key === model.filterKey}
              onClick={() => callbacks.onFilter(filter.key)}
              className={cn('mgr-control shrink-0 rounded-full',
                filter.key === model.filterKey && '!bg-[var(--text-primary)] !text-[var(--surface-1)]')}>
              {t('developerReference.mobileGrid.toolbar.filterCount', '{{label}} {{count}}', { label: filter.label, count: filter.count })}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
