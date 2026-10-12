/**
 * InboxPage — top-level Notifications inbox route.
 *
 * Data-first layout: compact active-backlog context (`InboxSummary`) over
 * the shared `InboxBody` evidence surface (`archived={false}`). The strip reads
 * the unfiltered active set so it stays a stable "backlog overview" while the
 * list below honours the user's URL-backed filters. Mirrors `ArchivedPage` for a
 * connected, consistent feel across the two notification surfaces. Complete
 * period metrics, timeline and breakdowns follow the primary list.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Archive } from 'lucide-react';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { BUTTON_BASE, BUTTON_VARIANTS, Caption, Icon } from '@/components/ui';
import { PageLayout } from '@/components/layout';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useDataState } from '@/hooks/useDataState';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useAlertRules,
  useNotificationLogs,
  type NotificationFilters,
} from '@/api/hooks/useNotifications';
import { InboxBody } from '../components/InboxBody';
import { InboxSummary } from '../components/InboxSummary';
import { NotificationReportPanel } from '../components/NotificationReportPanel';

export default function InboxPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.inbox.title', 'Inbox'));
  const { startInstant, endInstantExclusive, timezone } = useRangeState();

  const { reduce } = useMotionPreference();
  const vehiclesQuery = useVehicles();
  const rulesQuery = useAlertRules();
  const vehiclesState = useDataState({ ...vehiclesQuery, data: vehiclesQuery.data ?? undefined });
  const rulesState = useDataState({ ...rulesQuery, data: rulesQuery.data ?? undefined });
  const vehicles = vehiclesQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const metadataSources = [
    { id: 'vehicles', label: t('notifications.alertStudio.editor.vehiclesLabel', 'Vehicles'),
      state: vehiclesState, empty: t('vehicles.emptyTitle', 'No vehicles yet'), count: vehicles.length },
    { id: 'rules', label: t('notifications.alertStudio.rules.title', 'Rules'),
      state: rulesState, empty: t('notifications.alertStudio.rules.emptyTitle', 'No alert rules yet'), count: rules.length },
  ];

  // The latest active notifications drive the recent KPI band; historical
  // period totals come from the report rather than this bounded list.
  const summaryFilters = useMemo<NotificationFilters>(() => ({ archived: false }), []);
  const summaryQuery = useNotificationLogs(summaryFilters);

  return (
    <PageLayout
      title={t('notifications.inbox.title', 'Inbox')}
      subtitle={t('notifications.inbox.subtitle', 'All system, alert, automation, and scheduled notifications in one place.')}
      copyLink
      query={summaryQuery}
      secondaryActions={
        <Link
          to="/notifications/archived"
          className={cn(
            BUTTON_BASE,
            BUTTON_VARIANTS.secondary,
            'min-h-11 min-w-11 max-w-full whitespace-normal break-words px-3 py-2 md:min-h-9',
            typography.size.xs,
            reduce && 'transition-none',
          )}
        >
          <Icon icon={Archive} size="sm" />
          {t('notifications.inbox.viewArchived', 'View archived')}
        </Link>
      }
    >
      <FadeIn>
        <InboxSummary query={summaryQuery} />
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
                <div role="status" aria-label={t('developerReference.layout.source.loading', 'Loading {{label}}', { label: source.label })}>
                  <Skeleton className="h-4 w-32 max-w-full" />
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
        <InboxBody archived={false} vehicles={vehicles} rules={rules} />
      </FadeIn>
      <FadeIn delay={0.1}>
        <NotificationReportPanel fromInstant={startInstant} toExclusive={endInstantExclusive} timezone={timezone} />
      </FadeIn>
    </PageLayout>
  );
}
