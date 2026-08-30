import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  CircleEllipsis,
  History,
  XCircle,
} from 'lucide-react';
import { Badge, Button, GlassPanel, Heading, Text } from '@/components/ui';
import { Timeline, type TimelineItemData } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import { formatRelative } from '@/lib/dateFormat';
import { getCommandLabel } from './commandLabels';

interface RecentCommandActivityProps {
  entries: CommandLogEntry[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}

export function RecentCommandActivity({
  entries,
  loading,
  error,
  onRetry,
}: RecentCommandActivityProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const recent = entries.slice(0, 5);

  const timelineItems = useMemo<TimelineItemData[]>(
    () => recent.map((entry) => {
      const success = entry.status === 'success';
      const failed = entry.status === 'failed';
      const status = success
        ? t('commands.activity.succeeded', 'Succeeded')
        : failed
          ? t('commands.activity.failed', 'Failed')
          : t('commands.activity.pending', 'Pending');
      const subtitle = failed && entry.error
        ? t('commands.activity.failedReason', '{{status}} · {{reason}}', {
            status,
            reason: entry.error,
          })
        : status;

      return {
        icon: success
          ? <CheckCircle2 className="h-3.5 w-3.5" />
          : failed
            ? <XCircle className="h-3.5 w-3.5" />
            : <CircleEllipsis className="h-3.5 w-3.5" />,
        title: getCommandLabel(entry.command, t),
        subtitle,
        time: formatRelative(entry.created_at),
        color: success ? '#22c55e' : failed ? '#ef4444' : '#f59e0b',
      };
    }),
    [recent, t],
  );

  return (
    <GlassPanel className="h-full p-4 sm:p-5" data-testid="command-activity">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Heading level="section">
            {t('commands.activity.title', 'Recent command activity')}
          </Heading>
          <Text as="p" variant="bodySm" className="mt-1">
            {t(
              'commands.activity.description',
              'Latest delivery outcomes for the selected vehicle.',
            )}
          </Text>
        </div>
        <Badge variant="neutral">{entries.length}</Badge>
      </div>

      <div className="mt-4">
        {error ? (
          <QueryError
            error={error}
            onRetry={onRetry}
            resourceName={t('commands.activity.resource', 'Command activity')}
          />
        ) : loading ? (
          <div
            role="status"
            aria-label={t('commands.activity.loading', 'Loading command activity')}
            className="space-y-3"
          >
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : recent.length > 0 ? (
          <Timeline items={timelineItems} />
        ) : (
          <EmptyState /* no-action: live vehicle state and permissions determine availability in this panel */
            icon={<History className="h-8 w-8" aria-hidden="true" />}
            title={t('commands.activity.emptyTitle', 'No commands sent yet')}
            message={t(
              'commands.activity.empty',
              'Command outcomes will appear here after the first request.',
            )}
            className="py-6"
          />
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="lg"
        className="mt-3 w-full"
        icon={<History className="h-4 w-4" aria-hidden="true" />}
        onClick={() => navigate('/command-history')}
      >
        {t('commands.viewHistory', 'View history')}
      </Button>
    </GlassPanel>
  );
}
