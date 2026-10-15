import { useTranslation } from 'react-i18next';
import { Button, Text } from '@/components/ui';
import { canLoadMore } from './helpers';
import type { MobileGridCallbacks, MobileGridModel } from './types';

interface Props { model: MobileGridModel; callbacks: MobileGridCallbacks }
export function MobileReferenceFooter({ model, callbacks }: Props) {
  const { t } = useTranslation();
  const paging = model.pagination;
  const selectedExport = model.exports.find(action => action.scope === 'selectedLoaded');
  return (
    <>
      {model.state.kind !== 'loading' && model.state.kind !== 'empty' && model.state.kind !== 'noMatch'
        && (model.state.kind !== 'error' || model.state.retained) && (
        <div className="mt-2 text-center">
          {paging.kind === 'single' && !paging.countInHeading && (
            <Text>{t('developerReference.mobileGrid.footer.rows', '{{count}} rows', { count: paging.count })}</Text>
          )}
          {paging.kind === 'cumulative' && (
            <>
              {canLoadMore(paging) && (
                <Button data-grid-load-more="" className="min-h-11 w-full" loading={paging.busy} onClick={callbacks.onLoadMore}>
                  {t('developerReference.mobileGrid.footer.loadMore', 'Load {{count}} more', { count: paging.nextCount })}
                </Button>
              )}
              <Text className="mt-2 block" role="status">{paging.total == null
                ? t('developerReference.mobileGrid.footer.showingUnknown', 'Showing {{count}} loaded rows', { count: paging.shown })
                : t('developerReference.mobileGrid.footer.showing', 'Showing {{count}} of {{total}}', { count: paging.shown, total: paging.total })}</Text>
            </>
          )}
          {paging.kind === 'replacing' && <Text role="note">{paging.notice}</Text>}
        </div>
      )}
      {model.selection.enabled && (
        <div className="mgr-selection sticky z-10 mt-2 flex flex-wrap items-center gap-2 bg-[var(--surface-1)] p-2">
          <Text role="status" className="mr-auto">{t('developerReference.mobileGrid.selection.count', '{{count}} selected', { count: model.selection.keys.length })}</Text>
          {selectedExport && (
            <Button variant="secondary" className="min-h-11" loading={model.exportBusy}
              disabled={selectedExport.disabled || model.selection.keys.length === 0}
              onClick={() => callbacks.onExport('selectedLoaded')}>{selectedExport.label}</Button>
          )}
          <Button variant="secondary" className="min-h-11" onClick={() => callbacks.onSelectionMode(false)}>
            {t('developerReference.mobileGrid.selection.cancel', 'Cancel')}
          </Button>
          {model.exportError && <Text role="alert" className="basis-full break-words">{model.exportError}</Text>}
        </div>
      )}
    </>
  );
}
