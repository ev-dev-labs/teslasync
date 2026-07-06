/**
 * ChannelsGrid — the hero band of the Channels page. Renders every configured
 * delivery channel as an auto-fit bento that flows from a single column on
 * phones to as many columns as the viewport allows on wide monitors. Owns its
 * own loading (skeletons), error (QueryError) and empty (EmptyState) states.
 */

import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import type { NotificationChannel } from '@/api/types';
import { ChannelCard } from './ChannelCard';

interface ChannelsGridProps {
  channels: NotificationChannel[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onEdit: (channel: NotificationChannel) => void;
  onAdd: () => void;
}

const AUTO_FIT = '[grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]';
const SKELETON_KEYS = [0, 1, 2] as const;

export function ChannelsGrid({
  channels, isLoading, isError, error, onRetry, onEdit, onAdd,
}: ChannelsGridProps) {
  const { t } = useTranslation();
  const rows = channels ?? [];

  if (isError) {
    // `error` can be nullish even while `isError` is true (a query that failed
    // without capturing a reason). QueryError renders nothing for a falsy
    // error, which would leave a blank panel — fall back to a real Error so the
    // user always gets a visible, retryable failure state.
    const resolvedError = error ?? new Error(t('notifications.channels.loadFailed', 'Failed to load channels'));
    return (
      <QueryError
        error={resolvedError}
        onRetry={onRetry}
        resourceName={t('notifications.channels.resource', 'Channels')}
      />
    );
  }

  if (isLoading && rows.length === 0) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t('notifications.channels.loading', 'Loading channels…')}
        className={`grid gap-3 sm:gap-4 xl:gap-5 ${AUTO_FIT}`}
      >
        {SKELETON_KEYS.map((i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="h-8 w-8" aria-hidden="true" />}
        title={t('notifications.channels.empty.title', 'No channels configured')}
        message={t('notifications.channels.empty.message', 'Add a notification channel to start receiving alerts via Discord, Slack, Telegram, Email, and more.')}
        action={{ label: t('notifications.channels.add', 'Add Channel'), onClick: onAdd }}
      />
    );
  }

  return (
    <ul
      aria-label={t('notifications.channels.listAria', 'Configured channels')}
      className={`grid list-none gap-3 sm:gap-4 xl:gap-5 ${AUTO_FIT}`}
    >
      {rows.map((ch) => (
        <li key={ch.id} className="min-w-0">
          <ChannelCard channel={ch} onEdit={onEdit} />
        </li>
      ))}
    </ul>
  );
}
