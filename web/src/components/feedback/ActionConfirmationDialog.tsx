import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Code } from '../ui/Typography';
import type { AppDesignOriginSnapshot } from '../ui/appDesignOrigin';

interface ActionConfirmationDialogProps {
  path: string;
  originSnapshot: AppDesignOriginSnapshot;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ActionConfirmationDialog({
  path,
  originSnapshot,
  onConfirm,
  onCancel,
}: ActionConfirmationDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmDialog
      open
      aboveNotifications
      originSnapshot={originSnapshot}
      title={t('actionConfirmation.title', 'Confirm sensitive action')}
      message={t('actionConfirmation.body', 'This action can change or remove data. Your authentication provider handles sign-in; TeslaSync only asks you to confirm your intent.')}
      details={<Code>{path}</Code>}
      requireTypedConfirmation="CONFIRM"
      typedConfirmationLabel={t('actionConfirmation.type', 'Type CONFIRM to continue')}
      confirmLabel={t('common.confirm', 'Confirm')}
      cancelLabel={t('common.cancel', 'Cancel')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
