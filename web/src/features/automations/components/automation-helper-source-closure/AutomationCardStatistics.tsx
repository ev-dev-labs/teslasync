import { useTranslation } from 'react-i18next';
import { Caption } from '@/components/ui';
import { Car, CheckCircle, SkipForward, XCircle } from 'lucide-react';
import type { Automation } from '@/api/types';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface AutomationCardStatisticsProps {
  automation: Automation;
  vehicleName?: string;
}

export function AutomationCardStatistics({ automation: a, vehicleName }: AutomationCardStatisticsProps) {
  const { t } = useTranslation();
  const { formatDateTime, formatRelativeTime } = useDateFormat();
  const { fmtInt } = useNumberFormatting();
  const failureCount = a.failure_count ?? 0;
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
          {a.last_triggered_at ? (
            <>
              <CheckCircle className="h-3 w-3 shrink-0 text-emerald-300" aria-hidden="true" />
              {t('automations.lastRun', 'Last')}: {formatRelativeTime(a.last_triggered_at)}
            </>
          ) : (
            <>
              <SkipForward className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('automations.neverRun', 'Never run')}
            </>
          )}
        </Caption>
        <Caption aria-hidden="true">·</Caption>
        <Caption>{t('automations.runs', 'Runs')}: {fmtInt(a.execution_count ?? 0)}</Caption>
        {failureCount > 0 && (
          <>
            <Caption aria-hidden="true">·</Caption>
            <Caption className="flex min-w-0 items-center gap-1 break-words">
              <XCircle className="h-3 w-3 shrink-0 text-rose-300" aria-hidden="true" />
              {t('automations.fails', 'Fails')}: {fmtInt(failureCount)}
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
