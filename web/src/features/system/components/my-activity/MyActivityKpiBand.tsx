/**
 * KPI band for the My Activity page — a full-width, responsive strip of
 * summary metrics derived from the user's activity feed. Reflows from 2 columns
 * on phones up to 5 on ultra-wide monitors so it never leaves dead side margins.
 */
import { useTranslation } from 'react-i18next';

import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief';

import { formatRelative } from '@/lib/dateFormat';
import type { ActivityKpis } from './myActivityAnalytics';

export interface MyActivityKpiBandProps {
  kpis?: ActivityKpis;
  isLoading: boolean;
  available?: boolean;
  retained?: boolean;
  scope?: string;
}


/**
 * Defensive computation fallback only. Unavailable source readings are
 * passed to the raw bridge as null, never presented as measured zeros.
 */
const EMPTY_KPIS: ActivityKpis = {
  total: 0,
  activeDays: 0,
  actionTypes: 0,
  entitiesTouched: 0,
  lastActivityTs: null,
};

export function MyActivityKpiBand({
  kpis, isLoading, available = kpis != null, retained = false, scope,
}: MyActivityKpiBandProps) {
  const { t } = useTranslation();

  const { total, activeDays, actionTypes, entitiesTouched, lastActivityTs } =
    kpis ?? EMPTY_KPIS;

  // `formatRelative` already collapses null / '' / invalid timestamps to an
  // em-dash, so it doubles as the empty-value guard here.
  const lastActive = formatRelative(lastActivityTs);

  return (
    <SystemSummaryBrief
      title={t('activity.myActivity.kpi.aria', 'Activity summary')}
      description={t('activity.myActivity.brief.description', 'Actions, active days, action types, and entities derived from the loaded personal activity feed.')}
      scope={scope ?? t('activity.myActivity.brief.scope', 'Loaded recent activity only; not a complete account lifetime total.')}
      available={available} retained={retained} loading={isLoading}
      metrics={[
        { metricId: 'count', occurrenceId: 'total', rawValue: available ? total : null, label: t('activity.myActivity.kpi.total', 'Total actions') },
        { metricId: 'count', occurrenceId: 'days', rawValue: available ? activeDays : null, label: t('activity.myActivity.kpi.activeDays', 'Active days') },
        { metricId: 'count', occurrenceId: 'types', rawValue: available ? actionTypes : null, label: t('activity.myActivity.kpi.actionTypes', 'Action types') },
        { metricId: 'count', occurrenceId: 'entities', rawValue: available ? entitiesTouched : null, label: t('activity.myActivity.kpi.entities', 'Entities touched') },
      ]}
      textMetrics={[{
        key: 'last-active', label: t('activity.myActivity.kpi.lastActive', 'Last active'),
        value: available ? lastActive : '—', valueState: available && lastActivityTs ? 'value' : 'missing',
        detail: t('activity.myActivity.brief.lastContext', 'Most recent timestamp in the loaded feed.'),
      }]}
    />
  );
}
