/**
 * ActivityFeedPanel — the full-width detail band. Wraps the shared
 * `RecentActivityFeed` timeline with a titled panel and its own loading / error
 * states; the feed itself renders a friendly empty state when there are no
 * entries, so this panel doesn't duplicate that branch.
 */
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import { RecentActivityFeed } from '@/components/data-display';
import { Icons } from '@/lib/icons';
import type { UserActivityEntry } from '@/types/admin';

export interface ActivityFeedPanelProps {
  entries: UserActivityEntry[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
}

export function ActivityFeedPanel({
  entries,
  isLoading,
  isError,
  error,
  onRetry,
  className,
}: ActivityFeedPanelProps) {
  const { t } = useTranslation();
  const rows = entries ?? [];

  return (
    <GlassPanel className={className}>
      <div className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Icons.history className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('activity.myActivity.feed.title', 'Activity feed')}
        </PanelTitle>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} height={40} />
            ))}
          </div>
        ) : isError ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : (
          <RecentActivityFeed
            entries={rows}
            emptyMessage={t('activity.myActivity.empty', 'No recent activity in this window.')}
          />
        )}
      </div>
    </GlassPanel>
  );
}
