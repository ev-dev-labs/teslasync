import { useTranslation } from 'react-i18next';
import { QueryError } from '@/components/feedback';
import { Text } from '@/components/ui';
import type { DataState } from '@/api/dataState';

interface MileageSourceNoticeProps {
  source: Pick<DataState<unknown>, 'refreshError' | 'isRefreshBlocked' | 'isRefreshing'>;
  onRetry: () => unknown;
}

/** Refresh feedback is additive: the panel's last successful content and
 * independent neighboring sources must remain mounted and actionable. */
export function MileageSourceNotice({ source, onRetry }: MileageSourceNoticeProps) {
  const { t } = useTranslation();
  if (source.refreshError) {
    return (
      <div className="space-y-2">
        <Text as="p" variant="bodySm" role="status">
          {t('mileage.source.retained', 'Refresh failed. Showing the last successful mileage data.')}
        </Text>
        <QueryError error={source.refreshError} onRetry={onRetry} />
      </div>
    );
  }
  if (source.isRefreshBlocked || source.isRefreshing) {
    return (
      <Text as="p" variant="bodySm" role="status">
        {source.isRefreshBlocked
          ? t('mileage.source.paused', 'Refresh is paused. Showing the last successful mileage data.')
          : t('mileage.source.refreshing', 'Refreshing mileage data. Previously loaded content remains available.')}
      </Text>
    );
  }
  return null;
}
