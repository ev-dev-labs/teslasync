import { useTranslation } from 'react-i18next';
import { ConfirmDialog, Text, Textarea } from '@/components/ui';
import { useOperationalMode } from '@/hooks/useOperationalMode';

interface RepairBulkDismissDialogProps {
  caseCount: number;
  reason: string;
  loading: boolean;
  canWrite?: boolean;
  writeBlockReason?: string;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RepairBulkDismissDialog({
  caseCount,
  reason,
  loading,
  canWrite = true,
  writeBlockReason,
  onReasonChange,
  onCancel,
  onConfirm,
}: RepairBulkDismissDialogProps) {
  const { t } = useTranslation();
  const operationalMode = useOperationalMode();
  const writeAllowed = canWrite && operationalMode.canWrite;

  return (
    <ConfirmDialog
      open={caseCount > 0}
      onCancel={onCancel}
      onConfirm={() => {
        if (!writeAllowed || loading || caseCount === 0 || !reason.trim()) return;
        onConfirm();
      }}
      title={t('dataRepair.cases.bulk.confirmDismiss', 'Dismiss selected findings?')}
      message={t(
        'dataRepair.cases.bulk.confirmDismissDescription',
        'Dismissal changes case metadata only. Source sessions remain untouched and the decision is audited.',
      )}
      confirmLabel={t('dataRepair.cases.bulk.dismiss', 'Dismiss selected')}
      variant="warning"
      loading={loading}
      confirmDisabled={!writeAllowed || !reason.trim()}
      details={(
        <>
        {!writeAllowed && <Text as="p" variant="caption" role="note">
          {writeBlockReason ?? operationalMode.writeBlockReason ?? t('dataRepair.cases.readOnly', 'Repair controls are read-only')}
        </Text>}
        <Textarea
          id="bulk-dismiss-reason"
          label={t('dataRepair.cases.reasonLabel', 'Operator note')}
          value={reason}
          disabled={!writeAllowed || loading}
          onChange={(event) => {
            if (!writeAllowed || loading) return;
            onReasonChange(event.target.value);
          }}
          rows={3}
          maxLength={2000}
          placeholder={t(
            'dataRepair.cases.bulk.reasonPlaceholder',
            'Explain why these findings are false positives',
          )}
        />
        </>
      )}
    />
  );
}
