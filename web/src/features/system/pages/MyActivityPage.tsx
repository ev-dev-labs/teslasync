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
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';

import { PageLayout } from '@/components/layout';
import { Button, GlassPanel, PanelTitle } from '@/components/ui';
import { AlertBanner, DataStateNotice, EmptyState, ErrorDisplay, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { Icons } from '@/lib/icons';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
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
  const location = useLocation();
  const [params] = useSearchParams();
  const legacyStart = params.get('start');
  const legacyEnd = params.get('end');
  const validDate = (value: string | null): value is string =>
    !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00`));

  if (!params.has('from') && !params.has('to') && !params.has('time_scope') &&
      validDate(legacyStart) && validDate(legacyEnd) && legacyStart <= legacyEnd) {
    const next = new URLSearchParams(params);
    next.set('from', legacyStart);
    next.set('to', legacyEnd);
    next.set('time_scope', 'custom');
    next.delete('start');
    next.delete('end');
    return <Navigate replace to={{ pathname: location.pathname, search: `?${next}`, hash: location.hash }} />;
  }

  return <MyActivityContent />;
}

function MyActivityContent() {
  const { t } = useTranslation();
  usePageTitle(t('activity.myActivity.title', 'My activity'));

  const { start, end, startInstant, endInstantExclusive } = useRangeState({
    persistKey: 'my-activity.range',
  });

  const query = useMyRecentActivity({
    start: startInstant,
    end: endInstantExclusive,
    limit: ACTIVITY_LIMIT,
  });
  const { data, isLoading, refetch } = query;
  const state = useDataState(query, { provenance: 'historical' });
  const error = state.fatalError;
  const isError = !!error;

  // Stabilise the array identity so the derived-analytics memo below and the
  // feed panel don't churn on every render while the query is pending (when
  // `data` is undefined, `data ?? []` would otherwise be a fresh array each time).
  const entries = useMemo(() => data ?? [], [data]);
  const apiError = query.error instanceof ApiError ? query.error : null;
  const featureDisabled = apiError?.status === 503;
  const unauthenticated = apiError?.status === 401;
  // Retained deployment failures warn without erasing data; identity gates still protect it.
  const hardGate = (featureDisabled && !state.hasData) || unauthenticated;

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
  const initialUnknown = state.status === 'initial' && query.fetchStatus !== 'fetching';
  const isEmpty = state.hasData && entries.length === 0;


  return (
    <PageLayout
      title={t('activity.myActivity.title', 'My activity')}
      subtitle={t(
        'activity.myActivity.subtitle',
        'Recent actions you have taken in TeslaSync.',
      )}
      query={query}
    >
      <StaleRefreshWarning state={state} />
      {hardGate ? (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-6">
            {featureDisabled ? (
              <DataStateNotice
                state="unsupported"
                title={t(
                  'activity.myActivity.disabled.title',
                  'Activity feed is not supported',
                )}
                message={t(
                  'activity.myActivity.disabled.description',
                  'Per-user activity is only available when TeslaSync is deployed behind an identity provider (ForwardAuth). Ask your administrator to configure FORWARD_AUTH_HEADER.',
                )}
              />
            ) : (
              <ErrorDisplay error={query.error} />
            )}
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          <FadeIn>
            <MyActivityKpiBand kpis={analytics.kpis} isLoading={isLoading && !state.hasData}
              available={state.hasData} retained={state.hasData && query.isError}
              scope={t('activity.myActivity.brief.range', 'Loaded activity for {{start}} – {{end}}; at most {{limit}} actions.', { start, end, limit: ACTIVITY_LIMIT })} />
          </FadeIn>

          {initialUnknown ? (
            <FadeIn>
              <AlertBanner
                variant="info"
                role="status"
                title={query.fetchStatus === 'paused'
                  ? t('dataSources.status.paused', 'Refresh paused')
                  : t('dataSources.status.pending', 'Pending')}
              >
                {t('dataSources.unavailableMessage', 'No requested source has returned usable data yet.')}
                <div className="mt-3">
                  <Button variant="ghost" onClick={retry}>{t('common.refresh', 'Refresh')}</Button>
                </div>
              </AlertBanner>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[
                  { title: t('activity.myActivity.trend.title', 'Activity over time'), className: 'md:col-span-2' },
                  { title: t('activity.myActivity.topActions.title', 'Top actions'), className: '' },
                  { title: t('activity.myActivity.byCategory.title', 'By category'), className: '' },
                  { title: t('activity.myActivity.byHour.title', 'By hour of day'), className: '' },
                  { title: t('activity.myActivity.feed.title', 'Activity feed'), className: 'md:col-span-2 xl:col-span-3' },
                ].map(({ title, className }) => (
                  <GlassPanel key={title} className={className}>
                    <div className="p-4 sm:p-5">
                      <PanelTitle className="mb-3">{title}</PanelTitle>
                      <EmptyState /* no-action: this informational panel has no local recovery action; parent-page source controls remain available. */ message={t('common.unknown', 'Unknown')} />
                    </div>
                  </GlassPanel>
                ))}
              </div>
            </FadeIn>
          ) : (
          <>
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
                icon={<Icons.workflow className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />}
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
                icon={<Icons.layoutGrid className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />}
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
        </>
      )}
    </PageLayout>
  );
}
