import { useTranslation } from 'react-i18next';
import { AlertCircle, Info } from 'lucide-react';

import { GlassPanel, PanelTitle, Badge, HelperText } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';

import { POWERSHARE_SIGNALS } from './constants';
import { humanizeEnum, stopReasonVariant } from './helpers';

interface StopReasonPanelProps {
  reason: string | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/** Last recorded reason Powershare was halted. */
export function StopReasonPanel({ reason, isLoading, error, onRetry }: StopReasonPanelProps) {
  const { t } = useTranslation();
  const label = humanizeEnum(reason, POWERSHARE_SIGNALS.stopReason);

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-rose-300" aria-hidden="true" />
        {t('powershare.stopReason.title', 'Stop Reason')}
      </PanelTitle>
      {isLoading ? (
        <Skeleton height={64} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : label ? (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={stopReasonVariant(reason)}>{label}</Badge>
          <HelperText className="max-w-md">
            {t('powershare.stopReason.help', 'Last recorded reason Powershare was halted.')}
          </HelperText>
        </div>
      ) : (
        <EmptyState /* no-action: transient — no halt recorded or signal not yet reported */
          icon={<Info className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'powershare.stopReason.noData',
            'No stop reason recorded. Powershare has not been halted, or the signal has not yet been reported.',
          )}
        />
      )}
    </GlassPanel>
  );
}
