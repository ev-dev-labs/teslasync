import { useTranslation } from 'react-i18next';
import { Button, Modal, RadioCard, Text } from '@/components/ui';
import type { MobileGridCallbacks, MobileGridModel } from './types';

interface Props { model: MobileGridModel; callbacks: MobileGridCallbacks }
export function MobileReferenceDialogs({ model, callbacks }: Props) {
  const { t } = useTranslation();
  const done = t('developerReference.mobileGrid.actions.done', 'Done');
  return (
    <>
      <Modal open={model.overlays.sort} onClose={() => callbacks.onOverlay('sort', false)}
        title={t('developerReference.mobileGrid.sort.title', 'Sort reference rows')}
        className="mgr-sort-sheet" size="sm"
        footer={<Button className="min-h-11 w-full" onClick={() => callbacks.onOverlay('sort', false)}>{done}</Button>}>
        <div role="radiogroup" aria-label={t('developerReference.mobileGrid.sort.order', 'Sort order')} className="space-y-2">
          {model.sortOptions.map(option => (
            <RadioCard key={option.key} name={`${model.id}-sort`} value={option.key}
              data-autofocus={model.sortKey === option.key ? '' : undefined}
              checked={model.sortKey === option.key} label={option.label} onChange={callbacks.onSort} />
          ))}
        </div>
      </Modal>
      <Modal open={model.overlays.overflow} onClose={() => callbacks.onOverlay('overflow', false)}
        title={t('developerReference.mobileGrid.toolbar.more', 'More grid actions')} size="sm"
        footer={<Button className="min-h-11 w-full" onClick={() => callbacks.onOverlay('overflow', false)}>{done}</Button>}>
        <div className="flex flex-col gap-2">
          {!model.selection.enabled && (
            <Button variant="secondary" className="min-h-11" onClick={() => {
              // Enter mode after the trigger regains focus on modal dismissal.
              callbacks.onOverlay('overflow', false);
              callbacks.onSelectionMode(true);
            }}>{t('developerReference.mobileGrid.selection.enter', 'Select')}</Button>
          )}
          {model.exports.map(action => (
            <Button key={action.scope} variant="secondary" className="min-h-11"
              disabled={action.disabled || (action.scope === 'selectedLoaded' && model.selection.keys.length === 0)}
              loading={model.exportBusy} onClick={() => callbacks.onExport(action.scope)}>{action.label}</Button>
          ))}
          {model.exportError && <Text role="alert" className="break-words">{model.exportError}</Text>}
        </div>
      </Modal>
    </>
  );
}
