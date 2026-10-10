import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, Modal, Text } from '@/components/ui';
import type { MobileRow } from '@/components/ui/mobile-grid-reference';

interface Props {
  row: MobileRow | undefined;
  actionDisabled: boolean;
  onClose: () => void;
  onAction: (message: string) => void;
}
export function ReferenceRecordDialog({ row, actionDisabled, onClose, onAction }: Props) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Modal open={row != null} onClose={() => { setConfirming(false); onClose(); }}
        title={t('developerReference.mobileGrid.details.title', 'Reference record: all fields and actions')}
        footer={<div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-11" onClick={() => onAction(
            t('developerReference.mobileGrid.details.actionNotice', 'REFERENCE FIXTURES: non-destructive row action invoked. No live record changed.'))}>
            {t('developerReference.mobileGrid.details.inspect', 'Inspect reference record')}
          </Button>
          <Button variant="danger" className="min-h-11" disabled={actionDisabled} onClick={() => setConfirming(true)}>
            {t('developerReference.mobileGrid.details.remove', 'Remove fixture (confirmation)')}
          </Button>
          <Button variant="secondary" className="min-h-11" onClick={onClose}>
            {t('developerReference.mobileGrid.actions.done', 'Done')}
          </Button>
        </div>}>
        <Text as="p" className="mb-3">
          {t('developerReference.mobileGrid.details.notice', 'REFERENCE FIXTURES. Summary-hidden fields remain here; disabled and destructive actions are not hidden.')}
        </Text>
        <dl className="space-y-3">
          {(row?.details ?? []).map(field => (
            <div key={field.key} className="min-w-0">
              <dt><Text weight="medium">{field.label}</Text></dt>
              <dd className="mt-1 break-words [overflow-wrap:anywhere]"><Text>{field.value}</Text></dd>
            </div>
          ))}
        </dl>
      </Modal>
      <ConfirmDialog open={confirming && row != null}
        title={t('developerReference.mobileGrid.details.confirmTitle', 'Confirm reference action')}
        message={t('developerReference.mobileGrid.details.confirmMessage', 'This only demonstrates confirmation and callback ownership. No fixture or live record is deleted.')}
        confirmLabel={t('developerReference.mobileGrid.details.confirm', 'Confirm fixture callback')}
        cancelLabel={t('developerReference.mobileGrid.selection.cancel', 'Cancel')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onAction(t('developerReference.mobileGrid.details.confirmNotice', 'REFERENCE FIXTURES: confirmed row-action callback invoked. No deletion performed.'));
        }} />
    </>
  );
}
