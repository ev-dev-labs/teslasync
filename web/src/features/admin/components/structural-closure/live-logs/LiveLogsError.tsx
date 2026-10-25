import { AlertTriangle } from 'lucide-react';
import { Card, MetricLabel, Text } from '@/components/ui';
import type { useLiveLogsPage } from '../../../hooks/useLiveLogsPage';

type Props = { controller: ReturnType<typeof useLiveLogsPage> };

export function LiveLogsError({ controller }: Props) {
  const { t, stream } = controller;

  return (
<Card
      className="border border-rose-500/30 p-4"
      data-testid="livelogs-error"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="h-5 w-5 shrink-0 text-rose-300"
          aria-hidden
        />
        <div>
          <MetricLabel className="mb-1 block">
            {t('liveLogs.error.title', 'Could not connect to log stream')}
          </MetricLabel>
          <Text variant="bodySm" as="p">
            {stream.error?.message ||
              t(
                'liveLogs.error.hint',
                'Check your network and admin permissions, then click Reconnect.',
              )}
          </Text>
        </div>
      </div>
    </Card>
  );
}
