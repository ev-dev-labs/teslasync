import { useTranslation } from 'react-i18next';
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief';
import { GlassPanel, Text } from '@/components/ui';

import { ACTIVITY_KINDS, ACTIVITY_KIND_LABELS, type ActivityItem } from '@/types/activity';
import { ymdInTz } from '@/lib/dateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ActivityOverviewProps {
  items: readonly ActivityItem[];
  total: number;
  offset: number;
  loading: boolean;
  error: boolean;
  timezone?: string;
  available?: boolean;
  retained?: boolean;
  scope?: string;
}

export function ActivityOverview({ items, total, offset, loading, error, timezone, available = !error, retained = false, scope }: ActivityOverviewProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const activeDays = new Set(items.map((item) => ymdInTz(new Date(item.occurred_at), timezone))).size;
  const criticalAlerts = items.filter((item) => item.kind === 'alert' && item.severity === 'critical').length;
  const pageCoverage = t('activity.timeline.overview.scope', 'Counts below describe only the loaded page (events {{start}}–{{end}} of {{total}}), not the entire selected range.', {
    start: items.length ? offset + 1 : 0,
    end: items.length ? offset + items.length : 0,
    total: error ? '—' : fmtInt(total),
  });

  return (
    <section aria-label={t('activity.timeline.overview.aria', 'Activity overview')} className="space-y-4">
          <SystemSummaryBrief
            title={t('activity.timeline.brief.countTitle', 'Range and page counts')}
            description={t('activity.timeline.brief.description', 'The server total covers the selected range; loaded events, days, and critical alerts describe this page only.')}
            scope={scope ?? t('activity.timeline.brief.scope', 'Selected range and current loaded page have different coverage.')}
            available={available} loading={loading} retained={retained}
            metrics={[
              { metricId: 'count', occurrenceId: 'range-total', rawValue: available ? total : null, label: t('activity.timeline.overview.total', 'Events in selected range') },
              { metricId: 'count', occurrenceId: 'page-events', rawValue: available ? items.length : null, label: t('activity.timeline.overview.shown', 'Events on this page') },
              { metricId: 'count', occurrenceId: 'page-days', rawValue: available ? activeDays : null, label: t('activity.timeline.overview.days', 'Days on this page') },
              { metricId: 'count', occurrenceId: 'page-critical', rawValue: available ? criticalAlerts : null, label: t('activity.timeline.overview.critical', 'Critical alerts on this page') },
            ]}
          />
          <GlassPanel className="p-4 sm:p-6">
            <Text as="p" variant="caption" className="mb-4">
              {pageCoverage}
            </Text>
            <SystemSummaryBrief
              title={t('activity.timeline.overview.mix', 'Event types on this page')}
              description={t('activity.timeline.brief.mixDescription', 'Counts by event type describe only the loaded page, not the entire selected range.')}
              scope={`${scope ?? t('activity.timeline.brief.scope', 'Selected range and current loaded page have different coverage.')} · ${pageCoverage}`}
              available={available} loading={loading} retained={retained}
              metrics={ACTIVITY_KINDS.map((kind) => ({
                metricId: 'count', occurrenceId: kind, rawValue: available ? items.filter((item) => item.kind === kind).length : null,
                label: t(`activity.timeline.kindFilter.${kind}`, ACTIVITY_KIND_LABELS[kind]),
              }))}
            />
          </GlassPanel>
    </section>
  );
}
