import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Cpu, Activity, DollarSign, Gauge } from 'lucide-react';
import { Grid } from '@/components/layout';
import {
  Badge, Card, IconBox,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  RadialGauge,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  CHART_COLORS,
} from '@/components/charts';
import { Skeleton } from '@/components/feedback';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { getAPIUsage, getWorkersHealth } from '@/api/devtools';
import { AccordionSection } from './AccordionSection';
import { getStatusIcon, statusToBadgeVariant } from './helpers';

export function DiagnosticsSection() {
  const { t } = useTranslation();

  const { data: apiUsage, isLoading: usageLoading } = useQuery({
    queryKey: ['system-status', 'api-usage'],
    queryFn: getAPIUsage,
    refetchInterval: 30_000,
  });

  const { data: workers, isLoading: workersLoading } = useQuery({
    queryKey: ['system-status', 'workers'],
    queryFn: getWorkersHealth,
    refetchInterval: 15_000,
  });

  const isLoading = usageLoading || workersLoading;

  const usageChartData = apiUsage
    ? [
        { name: t('Requests'), value: apiUsage.total_requests },
        { name: t('Skipped'), value: apiUsage.skipped_polls },
      ]
    : [];

  return (
    <AccordionSection
      icon={<Cpu className="h-5 w-5" />}
      title={t('Diagnostics')}
      description={t('API usage dashboard and worker health')}
      badges={
        workers ? (
          <Badge
            variant={workers.healthy_count === workers.total ? 'success' : 'warning'}
            size="sm"
          >
            {workers.healthy_count}/{workers.total} {t('workers healthy')}
          </Badge>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      ) : (
        <div className="space-y-6">
          {apiUsage && (
            <div>
              <h4 className="text-sm font-semibold text-white/90 mb-3">{t('API Usage')}</h4>
              <Grid cols={{ default: 2, md: 4 }} gap={3} className="mb-4">
                <MetricCard label={t('Total Requests')} value={fmtInt(apiUsage.total_requests)} icon={<Activity className="h-4 w-4" />} color="cyan" />
                <MetricCard label={t('Estimated Cost')} value={`$${fmtNumber(apiUsage.estimated_cost, 2)}`} icon={<DollarSign className="h-4 w-4" />} color="green" />
                <MetricCard label={t('Monthly Credit')} value={`$${fmtNumber(apiUsage.monthly_credit, 2)}`} icon={<DollarSign className="h-4 w-4" />} color="purple" />
                <MetricCard
                  label={t('Remaining')}
                  value={`$${fmtNumber(apiUsage.estimated_remaining, 2)}`}
                  icon={<Gauge className="h-4 w-4" />}
                  color="cyan"
                  subtitle={`${t('Skipped polls')}: ${fmtInt(apiUsage.skipped_polls)}`}
                />
              </Grid>

              <div className="flex justify-center mb-4">
                <RadialGauge
                  value={apiUsage.estimated_cost}
                  max={apiUsage.monthly_credit || 1}
                  label={t('Budget Used')}
                  unit="$"
                  color={
                    apiUsage.estimated_remaining > apiUsage.monthly_credit * 0.5
                      ? '#22c55e'
                      : apiUsage.estimated_remaining > apiUsage.monthly_credit * 0.2
                        ? '#f59e0b'
                        : '#ef4444'
                  }
                  size={140}
                />
              </div>

              <Card padding="sm">
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={usageChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: 'rgba(0,0,0,0.85)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {usageChartData.map((_, idx) => (
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>
          )}

          {workers ? (
            <div>
              <h4 className="text-sm font-semibold text-white/90 mb-3">{t('Worker Health')}</h4>
              {workers.workers.length > 0 ? (
                <Grid cols={{ default: 1, md: 2, lg: 3 }} gap={3}>
                  {workers.workers.map((w) => (
                    <Card key={w.name} padding="sm">
                      <div className="flex items-center gap-3">
                        <IconBox color={w.status === 'healthy' ? 'green' : 'red'} size="sm">
                          {getStatusIcon(w.status)}
                        </IconBox>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white/90 truncate">{w.name}</div>
                          <div className="text-xs text-white/40">{w.host} · {fmtNumber(w.latency_ms, 0)} ms</div>
                        </div>
                        <Badge variant={statusToBadgeVariant(w.status)} size="sm">{w.status}</Badge>
                      </div>
                      {w.error && (
                        <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{w.error}</div>
                      )}
                    </Card>
                  ))}
                </Grid>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-white/40">
                  <Activity className="h-8 w-8 opacity-20" />
                  <p className="text-xs">{t('common.noData', 'No data available')}</p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </AccordionSection>
  );
}
