/**
 * ArchivedPage — Notifications inbox scoped to archived items only.
 *
 * Data-first layout: a compact archived-backlog strip (`InboxSummary`)
 * over the shared `InboxBody` detail surface (`archived={true}` swaps the
 * bulk-action set from Archive to Restore). The KPI band reads the unfiltered
 * archived set so it stays a stable "backlog overview" while the list below
 * honours the user's URL-backed filters.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PageLayout } from '@/components/layout';
import { BUTTON_BASE, BUTTON_VARIANTS, Button, Caption, Icon, Text } from '@/components/ui';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useAlertRules,
  useNotificationLogs,
  type NotificationFilters,
} from '@/api/hooks/useNotifications';
import { InboxBody } from '../components/InboxBody';
import { InboxSummary } from '../components/InboxSummary';

export default function ArchivedPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.archived.title', 'Archived notifications'));

  const vehiclesQuery = useVehicles();
  const rulesQuery = useAlertRules();
  const vehiclesState = useDataState({ ...vehiclesQuery, data: vehiclesQuery.data ?? undefined });
  const rulesState = useDataState({ ...rulesQuery, data: rulesQuery.data ?? undefined });
  const vehicles = vehiclesQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const metadataSources = [
    { id: 'vehicles', label: t('notifications.alertStudio.editor.vehiclesLabel', 'Vehicles'),
      state: vehiclesState, fetching: vehiclesQuery.isFetching,
      empty: t('vehicles.emptyTitle', 'No vehicles yet'), count: vehicles.length },
    { id: 'rules', label: t('notifications.alertStudio.rules.title', 'Rules'),
      state: rulesState, fetching: rulesQuery.isFetching,
      empty: t('notifications.alertStudio.rules.emptyTitle', 'No alert rules yet'), count: rules.length },
  ];

  // This bounded, all-time sample is independent of the workspace-scoped
  // server-paginated list. Keep its scope explicit instead of claiming a total.
  const archivedFilters = useMemo<NotificationFilters>(() => ({ archived: true }), []);
  const summaryQuery = useNotificationLogs(archivedFilters);

  return (
    <PageLayout
      title={t('notifications.archived.title', 'Archived notifications')}
      subtitle={t(
        'notifications.archived.subtitle',
        'Notifications you previously archived. Restore to bring them back.',
      )}
      copyLink
      query={summaryQuery}
      secondaryActions={
        <Link
          to="/notifications/inbox"
          className={cn(
            BUTTON_BASE,
            BUTTON_VARIANTS.ghost,
            'min-h-11 min-w-11 max-w-full px-3 py-2 md:min-h-9',
          )}
        >
          <Icon icon={ArrowLeft} size="sm" className="rtl:rotate-180" />
          <Text as="span" variant="bodySm" className="min-w-0 break-words">
            {t('notifications.archived.backToInbox', 'Back to inbox')}
          </Text>
        </Link>
      }
    >
      <FadeIn>
        <InboxSummary query={summaryQuery} archived />
      </FadeIn>
      <FadeIn delay={0.05}>
        <div className="min-w-0 space-y-3">
          {metadataSources.filter(source => source.state.status !== 'ok' || source.count === 0).map(source => (
            <section key={source.id} aria-label={source.label} className="min-w-0 space-y-2">
              <Caption>{source.label}</Caption>
              {source.state.fatalError ? (
                <QueryError error={source.state.fatalError} onRetry={source.state.retry ?? undefined}
                  resourceName={source.label} compact />
              ) : !source.state.hasData ? (
                <div role="status" aria-label={source.fetching && !source.state.isRefreshBlocked
                  ? t('developerReference.layout.source.loading', 'Loading {{label}}', { label: source.label })
                  : source.label} className="min-w-0 space-y-2">
                  {source.fetching && !source.state.isRefreshBlocked ? (
                    <Skeleton className="h-4 w-32 max-w-full" />
                  ) : (
                    <>
                      <Caption>{source.state.isRefreshBlocked
                        ? t('fleetOps.brief.refreshBlocked', 'Refresh paused')
                        : t('common.unknown', 'Unknown')}</Caption>
                      {source.state.retry ? (
                        <Button type="button" variant="secondary" size="sm" wrapLabel
                          className="min-h-11 max-w-full md:min-h-9" onClick={source.state.retry}>
                          {t('common.retry', 'Retry')}
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : (
                <>
                  <StaleRefreshWarning state={source.state} label={source.label} />
                  {source.state.status === 'ok' && source.count === 0 ? <Caption>{source.empty}</Caption> : null}
                </>
              )}
            </section>
          ))}
        </div>
        <InboxBody archived={true} vehicles={vehicles} rules={rules} />
      </FadeIn>
    </PageLayout>
  );
}
