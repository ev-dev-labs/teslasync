/**
 * MyActivityPage — per-user activity feed.
 *
 * Phase-40 / Prompt 49 — Recent Activity Discoverability.
 *
 * Renders the current user's own audit-log entries (`/users/me/activity`) so
 * non-admins can answer questions like "what did I change last week?" without
 * needing the admin-wide audit view.
 *
 * The endpoint refuses to serve when the deployment isn't running behind a
 * ForwardAuth identity provider (HTTP 503); we surface that as a friendly
 * inline message rather than a generic error page.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback/EmptyState';
import { DateRangeFilter } from '@/components/forms/DateRangeFilter';
import { RecentActivityFeed } from '@/components/data-display/RecentActivityFeed';
import { Icons } from '@/lib/icons';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUrlBatch, useUrlString } from '@/hooks/useUrlState';
import { ApiError } from '@/lib/resilience';
import { useMyRecentActivity } from '@/api/hooks/useUser';

const DEFAULT_WINDOW_DAYS = 30;
const ACTIVITY_LIMIT = 200;

/** Returns a YYYY-MM-DD string for the given date, in local time. */
function isoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function MyActivityPage() {
  const { t } = useTranslation();
  usePageTitle(t('activity.myActivity.title', 'My Activity'));

  const defaults = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - (DEFAULT_WINDOW_DAYS - 1));
    return { start: isoDate(start), end: isoDate(today) };
  }, []);

  const [start, setStart] = useUrlString('start', defaults.start);
  const [end, setEnd] = useUrlString('end', defaults.end);
  const setRangeBatch = useUrlBatch();

  const { data, isLoading, error, refetch } = useMyRecentActivity({
    start,
    end,
    limit: ACTIVITY_LIMIT,
  });

  const entries = data ?? [];
  const apiError = error instanceof ApiError ? error : null;
  const featureDisabled = apiError?.status === 503;
  const unauthenticated = apiError?.status === 401;

  return (
    <PageContainer
      title={t('activity.myActivity.title', 'My Activity')}
      subtitle={t(
        'activity.myActivity.subtitle',
        'Recent actions you have taken in TeslaSync.',
      )}
      loading={isLoading}
    >
      <FadeIn>
        <GlassPanel className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <DateRangeFilter
              startDate={start}
              endDate={end}
              onStartDateChange={(value) => setStart(value)}
              onEndDateChange={(value) => setEnd(value)}
              onRangeChange={(r) => setRangeBatch({ start: r.start, end: r.end })}
            />
          </div>

          {featureDisabled ? (
            <EmptyState
              icon={<Icons.securityCheck className="h-8 w-8" />}
              title={t('activity.myActivity.disabled.title', 'Activity feed disabled')}
              message={t(
                'activity.myActivity.disabled',
                'Per-user activity is only available when TeslaSync is deployed behind an identity provider (ForwardAuth). Ask your administrator to configure AUTH_FORWARD_HEADER.',
              )}
            />
          ) : unauthenticated ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Icons.user className="h-8 w-8" />}
              title={t('activity.myActivity.unauthorized.title', 'Identity required')}
              message={t(
                'activity.myActivity.unauthorized',
                'Your request did not include an identity header. Sign in through your identity provider and try again.',
              )}
            />
          ) : apiError ? (
            <EmptyState
              icon={<Icons.warning className="h-8 w-8" />}
              title={t('activity.myActivity.error.title', 'Could not load activity')}
              message={apiError.message}
              action={{
                label: t('common.retry', 'Retry'),
                onClick: () => {
                  void refetch();
                },
              }}
            />
          ) : (
            <RecentActivityFeed entries={entries} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
