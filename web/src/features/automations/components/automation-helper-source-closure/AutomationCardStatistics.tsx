import { useTranslation } from 'react-i18next';
import { Caption } from '@/components/ui';
import { Car, CheckCircle, SkipForward, XCircle } from 'lucide-react';
import { automationNumber, automationTimestamp, type AutomationListItem } from '@/api/hooks/useAutomations';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface AutomationCardStatisticsProps {
  automation: AutomationListItem;
  vehicleName?: string;
}

export function AutomationCardStatistics({ automation: a, vehicleName }: AutomationCardStatisticsProps) {
  const { t } = useTranslation();
  const { formatDateTime, formatRelativeTime } = useDateFormat();
  const { fmtInt } = useNumberFormatting();
  const failureCount = automationNumber(a.failure_count);
  const executionCount = automationNumber(a.execution_count);
  const lastTriggeredAt = automationTimestamp(a.last_triggered_at);
  return (
    <>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        {vehicleName ? (
          <Caption className="flex min-w-0 items-start gap-1 break-words">
            <Car className="h-3 w-3 shrink-0" aria-hidden="true" />
            {vehicleName}
          </Caption>
        ) : (
          <Caption>{t('automations.allVehicles', 'All vehicles')}</Caption>
        )}
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-3">
        <Caption className="flex min-w-0 items-center gap-1 break-words">
          {lastTriggeredAt ? (
            <>
              <CheckCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('automations.lastRun', 'Last')}: {formatRelativeTime(lastTriggeredAt)}
            </>
          ) : (
            <>
              <SkipForward className="h-3 w-3 shrink-0" aria-hidden="true" />
              {executionCount === 0
                ? t('automations.neverRun', 'Never run')
                : `${t('automations.lastRun', 'Last')}: ${t('common.unknown', 'Unknown')}`}
            </>
          )}
        </Caption>
        <Caption aria-hidden="true">·</Caption>
        <Caption>{t('automations.runs', 'Runs')}: {executionCount == null ? t('common.unknown', 'Unknown') : fmtInt(executionCount)}</Caption>
        {(failureCount == null || failureCount > 0) && (
          <>
            <Caption aria-hidden="true">·</Caption>
            <Caption className="flex min-w-0 items-center gap-1 break-words">
              <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('automations.fails', 'Fails')}: {failureCount == null ? t('common.unknown', 'Unknown') : fmtInt(failureCount)}
            </Caption>
          </>
        )}
        {a.next_fire_time && (
          <>
            <Caption aria-hidden="true">·</Caption>
            <Caption className="min-w-0 break-words">
              {t('automations.nextFire', 'Next')}: {formatDateTime(a.next_fire_time)}
            </Caption>
          </>
        )}
      </div>
    </>
  );
}
