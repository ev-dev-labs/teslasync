import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { GlassPanel, Badge, Text, Caption } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import {
  ChartTooltip,
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, ChartLegend, EmbeddedChart,
} from '@/components/charts';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';
import type { DigestMetrics, AlertPieEntry } from '../weekly-digest/types';
import type { StatPeriod } from '@/lib/metric-reference';

interface AlertsPanelProps {
  metrics: DigestMetrics;
  period: StatPeriod;
  alertPieData: AlertPieEntry[];
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

const SEVERITY_ICON_CLASS: Record<string, string> = {
  critical: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300',
};
const SEVERITY_BADGE: Record<string, 'danger' | 'warning' | 'info'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

export function AlertsPanel({
  metrics,
  period,
  alertPieData,
  isLoading,
  isError,
  error,
  onRetry,
}: AlertsPanelProps) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const byType = metrics.alertsByType ?? {};
  const pieData = alertPieData ?? [];

  return (
    <LayoutCard
      title={t('analytics.weeklyDigest.alertsSection', 'Alerts')}
      actions={(metrics.alertTotal ?? 0) > 0 ? (
        <Badge variant="warning" size="sm">{fmtInt(metrics.alertTotal ?? 0)}</Badge>
      ) : undefined}
    >
      <Caption>{period.label}</Caption>
      {isLoading ? (
        <Skeleton height={220} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (metrics.alertTotal ?? 0) === 0 ? (
        // no-action: a successful zero-alert week is a healthy result, not missing data; the existing week navigation covers other periods.
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" aria-hidden="true" />}
          message={t('analytics.weeklyDigest.noAlerts', 'No alerts this week — everything looks great!')}
          className="py-8"
        />
      ) : (
        <>
          <Caption>{t('analytics.weeklyDigest.alertsBySeverity', 'Alerts by severity')}</Caption>
          <div
            className="flex min-w-0 flex-col gap-3"
            role="list"
            aria-label={t('analytics.weeklyDigest.alertsBySeverity', 'Alerts by severity')}
          >
            {Object.entries(byType).map(([severity, count]) => {
              const Icon = severity === 'critical'
                ? AlertCircle : severity === 'warning' ? AlertTriangle : Info;
              return (
                <GlassPanel
                  key={severity}
                  role="listitem"
                  className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon
                      className={cn('h-4 w-4 shrink-0', SEVERITY_ICON_CLASS[severity] ?? 'text-sky-300')}
                      aria-hidden="true"
                    />
                    <Text size="sm" color="primary" className="break-words">{severity}</Text>
                  </span>
                  <Badge variant={SEVERITY_BADGE[severity] ?? 'info'} size="sm">
                    {fmtInt(count)}
                  </Badge>
                </GlassPanel>
              );
            })}
          </div>
          {/* EmbeddedChart retains the host's single surface and owns plot
              sizing; no nested card or private responsive height policy. */}
          <Caption>{t('analytics.weeklyDigest.alertDistribution', 'Alert distribution')}</Caption>
          <EmbeddedChart
            title={t('analytics.weeklyDigest.alertDistribution', 'Alert distribution')}
            ariaLabel={t(
              'analytics.weeklyDigest.alertDistributionChartLabel',
              'Pie chart of alerts by severity',
            )}
            data={pieData.map(({ name, value }) => ({ name, value }))}
            dataColumns={[
              { key: 'name', label: t('analytics.weeklyDigest.severity', 'Severity') },
              { key: 'value', label: t('analytics.weeklyDigest.alerts', 'Alerts') },
            ]}
            fluid={false}
            empty={pieData.length === 0}
            emptyMessage={t('analytics.weeklyDigest.noAlertBreakdown', 'No severity breakdown to chart.')}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend verticalAlign="bottom" />
              </PieChart>
            </ResponsiveContainer>
          </EmbeddedChart>
        </>
      )}
    </LayoutCard>
  );
}
