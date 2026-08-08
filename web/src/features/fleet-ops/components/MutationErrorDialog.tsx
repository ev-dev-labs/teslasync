import { useTranslation } from 'react-i18next';
import { isApiError } from '@/api/client';
import { Button, Modal } from '@/components/ui';

interface MutationErrorDialogProps {
  error: unknown;
  resourceName: string;
  onClose: () => void;
  onRefresh: () => void;
}

export function MutationErrorDialog({
  error,
  resourceName,
  onClose,
  onRefresh,
}: MutationErrorDialogProps) {
  const { t } = useTranslation();
  const conflict = isApiError(error) && error.status === 409;
  const versionConflict = conflict && /changed|version|refresh/i.test(error.message);
  const title = versionConflict
    ? t('fleetOps.mutation.versionTitle', 'Record changed')
    : conflict
      ? t('fleetOps.mutation.conflictTitle', 'Conflicting change')
      : t('fleetOps.mutation.errorTitle', 'Change could not be saved');
  const message = versionConflict
    ? t('fleetOps.mutation.versionMessage', 'Someone updated this {{resource}} after it was loaded. Refresh before trying again.', { resource: resourceName })
    : conflict
      ? t('fleetOps.mutation.conflictMessage', 'This {{resource}} conflicts with another active record. Review periods and unique values.', { resource: resourceName })
      : t('fleetOps.mutation.errorMessage', 'The server could not apply this change. Your existing data was not modified.');

  return (
    <Modal open={error != null} onClose={onClose} title={title} size="sm">
      <p role="alert" className="text-sm text-[var(--text-secondary)]">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.close', 'Close')}
        </Button>
        {conflict && (
          <Button type="button" onClick={onRefresh}>
            {t('fleetOps.mutation.refresh', 'Refresh data')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
