/**
 * KPI band for the My Activity page — a full-width, responsive strip of
 * summary metrics derived from the user's activity feed. Reflows from 2 columns
 * on phones up to 5 on ultra-wide monitors so it never leaves dead side margins.
 */
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';
import { Icons } from '@/lib/icons';
import { fmtInt } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import type { ActivityKpis } from './myActivityAnalytics';

export interface MyActivityKpiBandProps {
  kpis: ActivityKpis;
  isLoading: boolean;
}

const CARD_COUNT = 5;

/**
 * Zeroed KPI snapshot used as a defensive fallback. A missing or partial
 * `kpis` payload degrades to zeros + an em-dash instead of throwing on
 * `kpis.lastActivityTs` and blanking the whole page.
 */
const EMPTY_KPIS: ActivityKpis = {
  total: 0,
  activeDays: 0,
  actionTypes: 0,
  entitiesTouched: 0,
  lastActivityTs: null,
};

export function MyActivityKpiBand({ kpis, isLoading }: MyActivityKpiBandProps) {
  const { t } = useTranslation();

  const { total, activeDays, actionTypes, entitiesTouched, lastActivityTs } =
    kpis ?? EMPTY_KPIS;

  // `formatRelative` already collapses null / '' / invalid timestamps to an
  // em-dash, so it doubles as the empty-value guard here.
  const lastActive = formatRelative(lastActivityTs);

  return (
    <section
      aria-label={t('activity.myActivity.kpi.aria', 'Activity summary')}
      aria-busy={isLoading}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-5"
    >
      {isLoading ? (
        <>
          <VisuallyHidden liveRegion>{t('common.loading', 'Loading…')}</VisuallyHidden>
          {Array.from({ length: CARD_COUNT }).map((_, i) => (
            <Skeleton key={i} height={76} className="rounded-xl" />
          ))}
        </>
      ) : (
        <>
          <MetricCard
            label={t('activity.myActivity.kpi.total', 'Total actions')}
            value={fmtInt(total)}
            icon={<Icons.activity className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('activity.myActivity.kpi.activeDays', 'Active days')}
            value={fmtInt(activeDays)}
            icon={<Icons.calendar className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('activity.myActivity.kpi.actionTypes', 'Action types')}
            value={fmtInt(actionTypes)}
            icon={<Icons.workflow className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('activity.myActivity.kpi.entities', 'Entities touched')}
            value={fmtInt(entitiesTouched)}
            icon={<Icons.database className="h-5 w-5" aria-hidden="true" />}
            color="blue"
          />
          <MetricCard
            label={t('activity.myActivity.kpi.lastActive', 'Last active')}
            value={lastActive}
            icon={<Icons.clock className="h-5 w-5" aria-hidden="true" />}
            color="amber"
          />
        </>
      )}
    </section>
  );
}
