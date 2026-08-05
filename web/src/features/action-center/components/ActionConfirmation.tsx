import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui';
import type {
  ActionCenterRecommendation,
  ActionCenterStateAction,
} from '@/types/actionCenter';

export interface PendingAction {
  recommendation: ActionCenterRecommendation;
  action: ActionCenterStateAction;
}

interface ActionConfirmationProps {
  pending: PendingAction | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ActionConfirmation({
  pending,
  loading,
  onConfirm,
  onCancel,
}: ActionConfirmationProps) {
  const { t } = useTranslation();
  if (!pending) return null;
  const action = t(`actionCenter.action.${pending.action}`, pending.action);
  return (
    <ConfirmDialog
      open
      variant="warning"
      loading={loading}
      title={t('actionCenter.confirm.title', 'Confirm inbox action')}
      message={t(
        'actionCenter.confirm.message',
        '{{action}} “{{title}}”? This changes only your Action Center state and does not control the vehicle or source record.',
        { action, title: pending.recommendation.title },
      )}
      confirmLabel={action}
      cancelLabel={t('common.cancel', 'Cancel')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
