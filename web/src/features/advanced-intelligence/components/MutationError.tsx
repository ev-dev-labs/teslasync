import { useTranslation } from 'react-i18next';
import { AlertBanner } from '@/components/feedback';

interface MutationErrorProps {
  error: unknown;
}

export function MutationError({ error }: MutationErrorProps) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <AlertBanner
      variant="danger"
      title={t('advancedIntelligence.error.title', 'Request could not be completed')}
    >
      {error instanceof Error
        ? error.message
        : t('advancedIntelligence.error.body', 'Review the scenario inputs and try again.')}
    </AlertBanner>
  );
}
