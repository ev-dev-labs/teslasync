/**
 * MyActivityPage — per-user activity intelligence.
 *
 * Renders the current user's own audit-log entries (`/users/me/activity`) so
 * non-admins can answer "what did I do, and when?" without the admin-wide audit
 * view. The single feed payload is projected into a full-width bento of derived
 * views — KPI band, daily trend, top actions, category + hour breakdowns, and
 * the chronological feed — each owning its loading / empty / error state.
 *
 * The endpoint refuses to serve when the deployment isn't running behind a
 * ForwardAuth identity provider (HTTP 503) or when the request carried no
 * identity header (HTTP 401); we surface those as friendly full-width notices
 * rather than a generic error page.
 */

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { RangePicker } from '@/components/forms';
import { Icons } from '@/lib/icons';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { ApiError } from '@/lib/resilience';
import { useMyRecentActivity } from '@/api/hooks/useUser';
import {
  deriveMyActivityAnalytics,
  MyActivityKpiBand,
  ActivityTrendPanel,
  ActivityBreakdownPanel,
  ActivityHourPanel,
  ActivityFeedPanel,
} from '../components/my-activity';

const ACTIVITY_LIMIT = 200;

export default function MyActivityPage() {
  const { t } = useTranslation();
  usePageTitle(t('activity.myActivity.title', 'My Activity'));

  const { start, end, setRange } = useRangeState({
    persistKey: 'my-activity.range',
    fromKey: 'start',
    toKey: 'end',
  });

  const query = useMyRecentActivity({ start, end, limit: ACTIVITY_LIMIT });
  const { data, isLoading, isError, error, refetch } = query;

  // Stabilise the array identity so the derived-analytics memo below and the
  // feed panel don't churn on every render while the query is pending (when
  // `data` is undefined, `data ?? []` would otherwise be a fresh array each time).
  const entries = useMemo(() => data ?? [], [data]);
  const apiError = error instanceof ApiError ? error : null;
  const featureDisabled = apiError?.status === 503;
  const unauthenticated = apiError?.status === 401;
  const hardGate = featureDisabled || unauthenticated;

  const analytics = useMemo(
    () => deriveMyActivityAnalytics(entries, { start, end }),
    [entries, start, end],
  );

  // Shared section state. Hard-gate failures (503 / 401) are surfaced by the
  // notice below, so the derived panels treat only non-gate failures as errors.
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const sectionIsError = isError && !hardGate;
  const isEmpty = !isLoading && !sectionIsError && entries.length === 0;

  const actions = (
    <RangePicker
      value={{ start, end }}
      onChange={setRange}
      align="end"
      triggerTestId="my-activity-range"
    />
  );

  return (
    <PageContainer
      title={t('activity.myActivity.title', 'My Activity')}
      subtitle={t(
        'activity.myActivity.subtitle',
        'Recent actions you have taken in TeslaSync.',
      )}
      actions={actions}
      query={query}
    >
      {hardGate ? (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-6">
            {featureDisabled ? (
              <EmptyState
                icon={<Icons.securityCheck className="h-8 w-8" />}
                title={t('activity.myActivity.disabled.title', 'Activity feed disabled')}
                message={t(
                  'activity.myActivity.disabled.description',
                  'Per-user activity is only available when TeslaSync is deployed behind an identity provider (ForwardAuth). Ask your administrator to configure AUTH_FORWARD_HEADER.',
                )}
              />
            ) : (
              <EmptyState /* no-action: auth gate — recovery is signing in via the identity provider */
                icon={<Icons.user className="h-8 w-8" />}
                title={t('activity.myActivity.unauthorized.title', 'Identity required')}
                message={t(
                  'activity.myActivity.unauthorized.description',
                  'Your request did not include an identity header. Sign in through your identity provider and try again.',
                )}
              />
            )}
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          <FadeIn>
            <MyActivityKpiBand kpis={analytics.kpis} isLoading={isLoading} />
          </FadeIn>

          <FadeIn delay={0.1}>
            <section
              aria-label={t('activity.myActivity.trend.title', 'Activity over time')}
              className="grid grid-cols-1 gap-4 xl:grid-cols-3"
            >
              <ActivityTrendPanel
                className="xl:col-span-2"
                data={analytics.dailyTrend}
                isLoading={isLoading}
                isError={sectionIsError}
                isEmpty={isEmpty}
                error={error}
                onRetry={retry}
              />
              <ActivityBreakdownPanel
                title={t('activity.myActivity.topActions.title', 'Top actions')}
                icon={<Icons.workflow className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                slices={analytics.topActions}
                isLoading={isLoading}
                isError={sectionIsError}
                isEmpty={isEmpty}
                error={error}
                onRetry={retry}
                emptyMessage={t('activity.myActivity.topActions.empty', 'No actions in this window.')}
                emptyIcon={<Icons.workflow className="h-8 w-8" />}
              />
            </section>
          </FadeIn>

          <FadeIn delay={0.2}>
            <section
              aria-label={t('activity.myActivity.breakdowns.aria', 'Activity breakdowns')}
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              <ActivityBreakdownPanel
                title={t('activity.myActivity.byCategory.title', 'By category')}
                icon={<Icons.layoutGrid className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                slices={analytics.byCategory}
                isLoading={isLoading}
                isError={sectionIsError}
                isEmpty={isEmpty}
                error={error}
                onRetry={retry}
                emptyMessage={t('activity.myActivity.byCategory.empty', 'No categories to break down yet.')}
                emptyIcon={<Icons.layoutGrid className="h-8 w-8" />}
              />
              <ActivityHourPanel
                data={analytics.byHour}
                isLoading={isLoading}
                isError={sectionIsError}
                isEmpty={isEmpty}
                error={error}
                onRetry={retry}
              />
            </section>
          </FadeIn>

          <FadeIn delay={0.3}>
            <ActivityFeedPanel
              entries={entries}
              isLoading={isLoading}
              isError={sectionIsError}
              error={error}
              onRetry={retry}
            />
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
