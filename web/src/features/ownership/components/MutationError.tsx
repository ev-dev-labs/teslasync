import { useTranslation } from 'react-i18next';
import { AlertBanner } from '@/components/feedback';

interface MutationErrorProps {
  error: unknown;
}

/** Inline banner for a failed write. Renders nothing when there is no error. */
export function MutationError({ error }: MutationErrorProps) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <AlertBanner
      variant="danger"
      title={t('ownership.error.title', 'Request could not be completed')}
    >
      {error instanceof Error
        ? error.message
        : t('ownership.error.body', 'Review the inputs and try again.')}
    </AlertBanner>
  );
}
