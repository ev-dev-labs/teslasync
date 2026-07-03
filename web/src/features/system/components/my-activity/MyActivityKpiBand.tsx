/**
 * KPI band for the My Activity page — a full-width, responsive strip of
 * summary metrics derived from the user's activity feed. Reflows from 2 columns
 * on phones up to 5 on ultra-wide monitors so it never leaves dead side margins.
 */
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { fmtInt } from '@/lib/numberFormat';
import { formatRelative } from '@/lib/dateFormat';
import type { ActivityKpis } from './myActivityAnalytics';

export interface MyActivityKpiBandProps {
  kpis: ActivityKpis;
  isLoading: boolean;
}

const CARD_COUNT = 5;

export function MyActivityKpiBand({ kpis, isLoading }: MyActivityKpiBandProps) {
  const { t } = useTranslation();

  const lastActive = kpis.lastActivityTs ? formatRelative(kpis.lastActivityTs) : '—';

  return (
    <section
      aria-label={t('activity.myActivity.kpi.aria', 'Activity summary')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-5"
    >
      {isLoading
        ? Array.from({ length: CARD_COUNT }).map((_, i) => (
            <Skeleton key={i} height={76} className="rounded-xl" />
          ))
        : (
          <>
            <MetricCard
              label={t('activity.myActivity.kpi.total', 'Total actions')}
              value={fmtInt(kpis.total)}
              icon={<Icons.activity className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('activity.myActivity.kpi.activeDays', 'Active days')}
              value={fmtInt(kpis.activeDays)}
              icon={<Icons.calendar className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('activity.myActivity.kpi.actionTypes', 'Action types')}
              value={fmtInt(kpis.actionTypes)}
              icon={<Icons.workflow className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('activity.myActivity.kpi.entities', 'Entities touched')}
              value={fmtInt(kpis.entitiesTouched)}
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
