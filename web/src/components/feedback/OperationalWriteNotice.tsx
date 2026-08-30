import { LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { AlertBanner } from './AlertBanner';

export interface OperationalWriteNoticeProps {
  title?: string;
  className?: string;
}

export function OperationalWriteNotice({
  title,
  className,
}: OperationalWriteNoticeProps) {
  const { t } = useTranslation();
  const operationalMode = useOperationalMode();

  if (operationalMode.canWrite) return null;

  return (
    <AlertBanner
      variant="warning"
      icon={<LockKeyhole className="h-4 w-4" aria-hidden="true" />}
      title={
        title
        ?? t(
          'operationalMode.writeNotice.title',
          'Operational changes are read-only',
        )
      }
      className={className}
    >
      {operationalMode.writeBlockReason
        ?? t(
          'operationalMode.writeBlocked',
          'Return to live mode before making operational changes.',
        )}
    </AlertBanner>
  );
}
