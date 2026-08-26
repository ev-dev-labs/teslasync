import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Save, Trash2, X } from 'lucide-react';

import { Button, ConfirmDialog } from '@/components/ui';

type PendingAction = 'save' | 'close' | 'discard' | null;

interface RepairFormActionsProps {
  kind: 'drive' | 'charging';
  sessionId: number;
  onSave: () => void;
  onCloseBoundary: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  savePending: boolean;
  closePending: boolean;
  discardPending: boolean;
  closeDisabled?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function RepairFormActions({
  kind,
  sessionId,
  onSave,
  onCloseBoundary,
  onDiscard,
  onCancel,
  savePending,
  closePending,
  discardPending,
  closeDisabled = false,
  disabled = false,
  disabledReason,
}: RepairFormActionsProps) {
  const { t } = useTranslation();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const isDrive = kind === 'drive';
  const kindLabel = isDrive
    ? t('dataRepair.kind.drive', 'Drive')
    : t('dataRepair.kind.charging', 'Charging session');
  const loading = savePending || closePending || discardPending;

  const confirm = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'save') onSave();
    if (action === 'close') onCloseBoundary();
    if (action === 'discard') onDiscard();
  };

  const title = pendingAction === 'discard'
    ? t('dataRepair.manualConfirm.discardTitle', 'Discard this session?')
    : pendingAction === 'close'
      ? t('dataRepair.manualConfirm.closeTitle', 'Apply this manual boundary?')
      : t('dataRepair.manualConfirm.saveTitle', 'Save these corrections?');
  const message = pendingAction === 'discard'
    ? t(
        'dataRepair.manualConfirm.discardMessage',
        'This permanently deletes {{kind}} #{{id}} and records the action in the audit log.',
        { kind: kindLabel, id: sessionId },
      )
    : pendingAction === 'close'
      ? t(
          'dataRepair.manualConfirm.closeMessage',
          'This uses the exact end timestamp you entered. The server will reject overlaps or concurrent changes and record the boundary in the audit log.',
        )
      : t(
          'dataRepair.manualConfirm.saveMessage',
          'This updates the entered measurements without changing the session boundary. The correction is recorded in the audit log.',
        );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => setPendingAction('save')}
          loading={savePending}
          disabled={disabled}
          title={disabledReason}
          icon={<Save className="h-4 w-4" aria-hidden="true" />}
          className="min-h-11"
        >
          {t('common.save', 'Save')}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setPendingAction('close')}
          loading={closePending}
          disabled={disabled || closeDisabled}
          title={closeDisabled
            ? t('dataRepair.field.validEndedAtRequired', 'Enter a valid RFC3339 end timestamp first.')
            : disabledReason}
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
          className="min-h-11"
        >
          {isDrive
            ? t('dataRepair.action.closeDrive', 'Close Drive')
            : t('dataRepair.action.closeSession', 'Close Session')}
        </Button>
        <Button
          variant="danger"
          onClick={() => setPendingAction('discard')}
          loading={discardPending}
          disabled={disabled}
          title={disabledReason}
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          className="min-h-11"
        >
          {t('dataRepair.action.discard', 'Discard')}
        </Button>
        <Button
          variant="ghost"
          onClick={onCancel}
          icon={<X className="h-4 w-4" aria-hidden="true" />}
          className="ml-auto min-h-11"
        >
          {t('common.cancel', 'Cancel')}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        variant={pendingAction === 'discard' ? 'danger' : 'warning'}
        title={title}
        message={message}
        confirmLabel={pendingAction === 'discard'
          ? t('dataRepair.action.discard', 'Discard')
          : t('common.confirm', 'Confirm')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={loading}
        onConfirm={confirm}
        onCancel={() => setPendingAction(null)}
      />
    </>
  );
}
