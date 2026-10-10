import { useTranslation } from 'react-i18next';
import { AlertBanner } from '@/components/feedback';
import { Button } from '@/components/ui';
import type { DataState } from '@/api/dataState';

export interface PressureRefreshNoticeProps {
  source: Pick<DataState<unknown>, 'hasData' | 'refreshError' | 'isRefreshBlocked' | 'retry'>;
  label: string;
}

/** A refresh problem is a warning beside retained content, never a fatal
 * replacement. Do not expose arbitrary network payloads as user-facing text.
 */
export function PressureRefreshNotice({ source, label }: PressureRefreshNoticeProps) {
  const { t } = useTranslation();
  if (!source.hasData || (!source.refreshError && !source.isRefreshBlocked)) return null;
  return (
    <AlertBanner variant="warning" title={t('developerReference.stats.state.retained', 'Showing retained measurements')}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1">
          {source.refreshError
            ? t('tirePressure.retainedRefresh', 'Could not refresh {{source}}. Retained readings remain available.', { source: label })
            : t('tirePressure.pausedRefresh', 'Refresh of {{source}} is paused. Retained readings remain available.', { source: label })}
        </p>
        {source.retry && <Button variant="secondary" size="sm" onClick={source.retry}>
          {t('error.retry', 'Retry')}
        </Button>}
      </div>
    </AlertBanner>
  );
}
