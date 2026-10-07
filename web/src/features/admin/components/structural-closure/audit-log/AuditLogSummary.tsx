import { ListChecks, CheckCircle2, AlertTriangle, Users, Tags, Activity } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import type { useAuditLogPage } from '../../../hooks/useAuditLogPage';

type Props = { controller: ReturnType<typeof useAuditLogPage> };

export function AuditLogSummary({ controller }: Props) {
  const { t, rows, failedCount, okCount, distinctActors, categoriesCount, actionsCount, countsReady, categoriesReady, actionsReady } = controller;

  return (
<FadeIn>
        <section
          aria-label={t('admin.auditLog.kpis', 'Audit overview')}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6"
        >
          <MetricCard
            label={t('admin.auditLog.kpiEntries', 'Entries shown')}
            value={countsReady ? rows.length : '—'}
            icon={<ListChecks className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('admin.auditLog.kpiOk', 'OK (in view)')}
            value={countsReady ? okCount : '—'}
            icon={<CheckCircle2 className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('admin.auditLog.kpiFailed', 'Failed (in view)')}
            value={countsReady ? failedCount : '—'}
            icon={<AlertTriangle className="h-5 w-5" />}
            color="red"
          />
          <MetricCard
            label={t('admin.auditLog.kpiActors', 'Actors (in view)')}
            value={countsReady ? distinctActors : '—'}
            icon={<Users className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('admin.auditLog.kpiCategories', 'Categories')}
            value={categoriesReady ? categoriesCount : '—'}
            icon={<Tags className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('admin.auditLog.kpiActions', 'Action types')}
            value={actionsReady ? actionsCount : '—'}
            icon={<Activity className="h-5 w-5" />}
            color="amber"
          />
        </section>
      </FadeIn>
  );
}
