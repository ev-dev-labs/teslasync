import { useTranslation } from 'react-i18next';
import { SourceContent } from '@/components/layout';

export function VehicleSourcePause({ label, message, retained, onRetry }: {
  label: string;
  message: string;
  retained: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return <SourceContent state={retained ? 'retained' : 'empty'} label={label}
    emptyMessage={message} errorMessage={message}
    retainedMessage={`${t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')} ${message}`}
    errorRecovery={{ onRetry, resourceName: label }}
    emptyRecovery={{ action: { label: t('error.retry', 'Retry'), onClick: onRetry } }}
  >{null}</SourceContent>;
}
