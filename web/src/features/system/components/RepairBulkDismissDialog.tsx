import { useTranslation } from 'react-i18next';
import { ConfirmDialog, Textarea } from '@/components/ui';

interface RepairBulkDismissDialogProps {
  caseCount: number;
  reason: string;
  loading: boolean;
  onReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RepairBulkDismissDialog({
  caseCount,
  reason,
  loading,
  onReasonChange,
  onCancel,
  onConfirm,
}: RepairBulkDismissDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      open={caseCount > 0}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title={t('dataRepair.cases.bulk.confirmDismiss', 'Dismiss selected findings?')}
      message={t(
        'dataRepair.cases.bulk.confirmDismissDescription',
        'Dismissal changes case metadata only. Source sessions remain untouched and the decision is audited.',
      )}
      confirmLabel={t('dataRepair.cases.bulk.dismiss', 'Dismiss selected')}
      variant="warning"
      loading={loading}
      confirmDisabled={!reason.trim()}
      details={(
        <Textarea
          id="bulk-dismiss-reason"
          label={t('dataRepair.cases.reasonLabel', 'Operator note')}
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t(
            'dataRepair.cases.bulk.reasonPlaceholder',
            'Explain why these findings are false positives',
          )}
        />
      )}
    />
  );
}
