/**
 * DLQ Inspector — status header.
 *
 * Renders three StatCards summarising the current DLQ state and an
 * AlertBanner when `replay_enabled` is false so an operator immediately
 * sees that the replay button below will return HTTP 403 instead of
 * publishing.
 */
import { useTranslation } from 'react-i18next';
import { AlertOctagon, Inbox, ShieldCheck } from 'lucide-react';

import { StatCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { fmtInt } from '@/lib/numberFormat';
import type { DLQListResponse } from '@/types/admin-diagnostics';

interface StatusHeaderProps {
  data: DLQListResponse | undefined;
  loading: boolean;
}

export function StatusHeader({ data, loading }: StatusHeaderProps) {
  const { t } = useTranslation();
  const count = data?.count ?? 0;
  const replayable = (data?.entries ?? []).filter((e) => e.replayable).length;
  const enabled = data?.replay_enabled ?? false;

  return (
    <div className="space-y-4">
      <Grid cols={{ default: 1, sm: 3 }} gap={4}>
        <StatCard
          label={t('admin.dlq.stats.total', 'Total entries')}
          value={loading ? '—' : fmtInt(count)}
          icon={<Inbox className="h-5 w-5" />}
          sublabel={t('admin.dlq.stats.totalSub', 'in dead-letter queue')}
        />
        <StatCard
          label={t('admin.dlq.stats.replayable', 'Replayable')}
          value={loading ? '—' : fmtInt(replayable)}
          icon={<ShieldCheck className="h-5 w-5" />}
          sublabel={t('admin.dlq.stats.replayableSub', 'parsed with source topic')}
        />
        <StatCard
          label={t('admin.dlq.stats.replayMode', 'Replay mode')}
          value={
            loading
              ? '—'
              : enabled
                ? t('admin.dlq.stats.enabled', 'Enabled')
                : t('admin.dlq.stats.disabled', 'Disabled')
          }
          icon={<AlertOctagon className="h-5 w-5" />}
          sublabel={t('admin.dlq.stats.replayModeSub', 'DLQ_REPLAY_ENABLED env')}
        />
      </Grid>

      {!loading && !enabled && (
        <AlertBanner
          variant="warning"
          title={t('admin.dlq.banners.disabledTitle', 'DLQ replay is disabled')}
        >
          {t(
            'admin.dlq.banners.disabledMessage',
            'The DLQ_REPLAY_ENABLED env flag is not set on this server. Replay attempts will return HTTP 403 and be logged as result="disabled".',
          )}
        </AlertBanner>
      )}
    </div>
  );
}
