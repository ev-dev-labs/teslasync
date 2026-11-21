import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import type { useReminderBrowser } from './useReminderBrowser';

export function ReminderBrowserStatus({ browser, device, state, id }: ReturnType<typeof useReminderBrowser>) {
  const { t } = useTranslation();
  if (browser.status === 'error') {
    return <Button type="button" className="min-h-11" variant="secondary" onClick={browser.retry}>
      {t('admin.security.windowRain.retryBrowser', 'Retry browser verification check')}
    </Button>;
  }
  if (state.fatalError) return <QueryError error={state.fatalError} onRetry={() => void device.refetch()} />;
  if (browser.status === 'checking' || device.isLoading) return <Skeleton lines={2} />;
  return <div className="space-y-1">
    <StaleRefreshWarning state={state} />
    <Text as="p" variant="bodySm">{id != null
      ? t('admin.security.windowRain.browserReady', 'This browser is verified for personal delivery.')
      : <Link to="/settings/smart-charging" className="inline-flex min-h-11 items-center text-theme-accent underline underline-offset-2">
        {t('admin.security.windowRain.verifyBrowser', 'Verify this browser in personal delivery settings')}
      </Link>}
    </Text>
  </div>;
}
