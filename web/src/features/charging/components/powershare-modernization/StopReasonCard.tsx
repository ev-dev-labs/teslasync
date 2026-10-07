import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, HelperText } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { POWERSHARE_SIGNALS, humanizeEnum } from '../powershare';
import { stopReasonVariant } from '../powershare/helpers';

interface StopReasonCardProps {
  reason: string | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function StopReasonCard({ reason, isLoading, error, onRetry }: StopReasonCardProps) {
  const { t } = useTranslation();
  const label = humanizeEnum(reason, POWERSHARE_SIGNALS.stopReason);
  return (
    <LayoutCard title={t('powershare.stopReason.title', 'Stop Reason')}>
      {isLoading ? <Skeleton height={64} /> : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : label ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={stopReasonVariant(reason)}>{label}</Badge>
          <HelperText className="max-w-md">
            {t('powershare.stopReason.help', 'Last recorded reason Powershare was halted.')}
          </HelperText>
        </div>
      ) : (
        <EmptyState /* no-action: no stop has been reported */
          icon={<Info className="h-8 w-8" aria-hidden="true" />}
          message={t('powershare.stopReason.noData', 'No stop reason recorded. Powershare has not been halted, or the signal has not yet been reported.')}
        />
      )}
    </LayoutCard>
  );
}
