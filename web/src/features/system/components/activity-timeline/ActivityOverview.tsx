import { useTranslation } from 'react-i18next';
import { MetricCard } from '@/components/data-display';
import { GlassPanel, SectionTitle, Text } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { fmtInt } from '@/lib/numberFormat';
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABELS, type ActivityItem } from '@/types/activity';
import { ymdInTz } from '@/lib/dateFormat';

interface ActivityOverviewProps {
  items: readonly ActivityItem[];
  total: number;
  offset: number;
  loading: boolean;
  error: boolean;
  timezone?: string;
}

export function ActivityOverview({ items, total, offset, loading, error, timezone }: ActivityOverviewProps) {
  const { t } = useTranslation();
  const activeDays = new Set(items.map((item) => ymdInTz(new Date(item.occurred_at), timezone))).size;
  const criticalAlerts = items.filter((item) => item.kind === 'alert' && item.severity === 'critical').length;
  const value = (n: number) => error ? '—' : fmtInt(n);

  return (
    <section aria-label={t('activity.timeline.overview.aria', 'Activity overview')} className="space-y-4">
      {loading ? (
        <Skeleton lines={3} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label={t('activity.timeline.overview.total', 'Events in selected range')} value={value(total)} icon={<Icons.activity className="h-5 w-5" aria-hidden="true" />} />
            <MetricCard label={t('activity.timeline.overview.shown', 'Events on this page')} value={value(items.length)} icon={<Icons.workflow className="h-5 w-5" aria-hidden="true" />} />
            <MetricCard label={t('activity.timeline.overview.days', 'Days on this page')} value={value(activeDays)} icon={<Icons.calendar className="h-5 w-5" aria-hidden="true" />} />
            <MetricCard label={t('activity.timeline.overview.critical', 'Critical alerts on this page')} value={value(criticalAlerts)} icon={<Icons.warning className="h-5 w-5" aria-hidden="true" />} />
          </div>
          <GlassPanel className="p-4 sm:p-6">
            <SectionTitle>{t('activity.timeline.overview.mix', 'Event types on this page')}</SectionTitle>
            <Text as="p" variant="caption" className="mb-4">
              {t('activity.timeline.overview.scope', 'Counts below describe only the loaded page (events {{start}}–{{end}} of {{total}}), not the entire selected range.', {
                start: items.length ? offset + 1 : 0,
                end: items.length ? offset + items.length : 0,
                total: error ? '—' : fmtInt(total),
              })}
            </Text>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {ACTIVITY_KINDS.map((kind) => (
                <div key={kind} className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
                  <Text as="p" variant="caption">{t(`activity.timeline.kindFilter.${kind}`, ACTIVITY_KIND_LABELS[kind])}</Text>
                  <Text as="p" variant="bodySm">{value(items.filter((item) => item.kind === kind).length)}</Text>
                </div>
              ))}
            </div>
          </GlassPanel>
        </>
      )}
    </section>
  );
}
