import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { Button, Text } from '@/components/ui';

export function SourceTrustNotice({ source, label }: { source: DataState<unknown>; label: string }) {
  const { t } = useTranslation();
  if (source.hasData) return <StaleRefreshWarning state={source} label={label} />;
  if (!source.isRefreshBlocked) return null;
  return (
    <AlertBanner variant="info" role="status">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <Text as="p" variant="bodySm">
          {t('battery.modernization.pausedInitial', 'This request is paused while the device is offline. No measurements have loaded yet.')}
        </Text>
        {source.retry && <Button type="button" variant="ghost" className="min-h-11" onClick={source.retry}>
          {t('common.retry', 'Retry')}
        </Button>}
      </div>
    </AlertBanner>
  );
}
