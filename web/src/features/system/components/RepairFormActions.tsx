import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Archive, Clock, Save, X } from 'lucide-react';

import {
  useRepairImpactPreview,
  type ManualCloseRepairInput,
} from '@/api/hooks/useDataRepair';
import { InlineCallout } from '@/components/feedback';
import { Button, ConfirmDialog, Textarea } from '@/components/ui';
import { RepairImpactSummary } from './RepairImpactSummary';

type PendingAction = 'save' | 'close' | 'quarantine' | null;

interface RepairFormActionsProps {
  kind: 'drive' | 'charging';
  sessionId: number;
  onSave: () => void;
  onCloseBoundary: (input: ManualCloseRepairInput) => void;
  onQuarantine: (reason: string) => void;
  onCancel: () => void;
  savePending: boolean;
  closePending: boolean;
  quarantinePending: boolean;
  closeDisabled?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  closePreviewInput: ManualCloseRepairInput;
}

export function RepairFormActions({
  kind,
  sessionId,
  onSave,
  onCloseBoundary,
  onQuarantine,
  onCancel,
  savePending,
  closePending,
  quarantinePending,
  closeDisabled = false,
  disabled = false,
  disabledReason,
  closePreviewInput,
}: RepairFormActionsProps) {
  const { t } = useTranslation();
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [reviewedCloseInput, setReviewedCloseInput] =
    useState<ManualCloseRepairInput | null>(null);
  const [quarantineReason, setQuarantineReason] = useState('');
  const preview = useRepairImpactPreview(kind);
  const isDrive = kind === 'drive';
  const kindLabel = isDrive
    ? t('dataRepair.kind.drive', 'Drive')
    : t('dataRepair.kind.charging', 'Charging session');
  const loading = savePending || closePending || quarantinePending;
  const previewError = preview.error instanceof Error ? preview.error.message : undefined;

  const requestClosePreview = () => {
    const input = { ...closePreviewInput };
    setReviewedCloseInput(null);
    preview.reset();
    preview.mutate(input, {
      onSuccess: () => {
        setReviewedCloseInput(input);
        setPendingAction('close');
      },
    });
  };

  const confirm = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'save') onSave();
    if (action === 'close' && reviewedCloseInput) {
      onCloseBoundary(reviewedCloseInput);
      setReviewedCloseInput(null);
    }
    if (action === 'quarantine' && quarantineReason.trim()) {
      onQuarantine(quarantineReason.trim());
      setQuarantineReason('');
    }
  };

  const title = pendingAction === 'quarantine'
    ? t('dataRepair.manualConfirm.quarantineTitle', 'Move this session to quarantine?')
    : pendingAction === 'close'
      ? t('dataRepair.manualConfirm.closeTitle', 'Apply this manual boundary?')
      : t('dataRepair.manualConfirm.saveTitle', 'Save these corrections?');
  const message = pendingAction === 'quarantine'
    ? t(
        'dataRepair.manualConfirm.quarantineMessage',
        'This removes {{kind}} #{{id}} from active data, but preserves a checksummed snapshot for verified restore. The reason and operator are recorded in the audit log.',
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
          onClick={requestClosePreview}
          loading={closePending || preview.isPending}
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
          onClick={() => setPendingAction('quarantine')}
          loading={quarantinePending}
          disabled={disabled}
          title={disabledReason}
          icon={<Archive className="h-4 w-4" aria-hidden="true" />}
          className="min-h-11"
        >
          {t('dataRepair.action.quarantine', 'Move to quarantine')}
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

      {previewError && (
        <InlineCallout variant="danger" icon={<AlertTriangle />}>
          {previewError}
        </InlineCallout>
      )}

      <ConfirmDialog
        open={pendingAction !== null}
        variant="warning"
        title={title}
        message={message}
        details={
          pendingAction === 'close' && preview.data
            ? <RepairImpactSummary preview={preview.data} />
            : pendingAction === 'quarantine'
              ? (
                  <Textarea
                    id={`quarantine-reason-${kind}-${sessionId}`}
                    label={t('dataRepair.cases.reasonLabel', 'Operator note')}
                    value={quarantineReason}
                    onChange={(event) => setQuarantineReason(event.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder={t(
                      'dataRepair.manualConfirm.quarantineReasonPlaceholder',
                      'Explain why this session should be removed from active data',
                    )}
                  />
                )
              : undefined
        }
        confirmLabel={pendingAction === 'quarantine'
          ? t('dataRepair.action.quarantine', 'Move to quarantine')
          : t('common.confirm', 'Confirm')}
        cancelLabel={t('common.cancel', 'Cancel')}
        loading={loading}
        onConfirm={confirm}
        onCancel={() => {
          setPendingAction(null);
          setReviewedCloseInput(null);
          setQuarantineReason('');
          preview.reset();
        }}
        confirmDisabled={pendingAction === 'quarantine' && !quarantineReason.trim()}
      />
    </>
  );
}
