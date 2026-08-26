import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineCallout } from '@/components/feedback';

interface RepairRefreshWarningProps {
  message: string;
  onRetry: () => void;
  testId: string;
}

export function RepairRefreshWarning({
  message,
  onRetry,
  testId,
}: RepairRefreshWarningProps) {
  const { t } = useTranslation();

  return (
    <InlineCallout
      variant="warning"
      icon={<AlertTriangle />}
      action={{
        label: t('common.retry', 'Retry'),
        onClick: onRetry,
      }}
      className="mb-3"
      testId={testId}
    >
      {message}
    </InlineCallout>
  );
}
