import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { GlassPanel, Badge, PanelTitle, Text, Caption } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import {
  ChartTooltip,
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { fmtInt } from '@/lib/numberFormat';
import type { DigestMetrics, AlertPieEntry } from './types';

interface AlertsSectionProps {
  metrics: DigestMetrics;
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

export function AlertsSection({
  metrics,
  alertPieData,
  isLoading,
  isError,
  error,
  onRetry,
}: AlertsSectionProps) {
  const { t } = useTranslation();
  const byType = metrics.alertsByType ?? {};
  const pieData = alertPieData ?? [];

  return (
    <GlassPanel className="flex h-full flex-col gap-5 p-4 sm:p-5">
      <PanelTitle className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('analytics.weeklyDigest.alertsSection', 'Alerts')}
        {(metrics.alertTotal ?? 0) > 0 && (
          <Badge variant="warning" size="sm">
            {fmtInt(metrics.alertTotal ?? 0)}
          </Badge>
        )}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={220} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (metrics.alertTotal ?? 0) === 0 ? (
        <EmptyState /* no-action: transient empty state — surfaces when no alerts exist for the week */
          icon={<AlertTriangle className="h-8 w-8" />}
          message={t(
            'analytics.weeklyDigest.noAlerts',
            'No alerts this week — everything looks great!',
          )}
          className="py-8"
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2">
          {/* Alert count by severity */}
          <div className="space-y-3">
            <Caption className="block">
              {t('analytics.weeklyDigest.alertsBySeverity', 'Alerts by Severity')}
            </Caption>
            <div
              className="grid gap-3"
              role="list"
              aria-label={t('analytics.weeklyDigest.alertsBySeverity', 'Alerts by Severity')}
            >
              {Object.entries(byType).map(([severity, count]) => {
                const Icon =
                  severity === 'critical' ? AlertCircle : severity === 'warning' ? AlertTriangle : Info;
                return (
                  <GlassPanel
                    key={severity}
                    role="listitem"
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <span className="flex items-center gap-2">
                      <Icon
                        className={`h-4 w-4 ${SEVERITY_ICON_CLASS[severity] ?? 'text-sky-300'}`}
                        aria-hidden="true"
                      />
                      <Text size="sm" color="primary" className="capitalize">
                        {severity}
                      </Text>
                    </span>
                    <Badge variant={SEVERITY_BADGE[severity] ?? 'info'} size="sm">
                      {fmtInt(count)}
                    </Badge>
                  </GlassPanel>
                );
              })}
            </div>
          </div>

          {/* Alert distribution pie chart */}
          <div className="flex flex-col items-center">
            <Caption className="mb-2 block">
              {t('analytics.weeklyDigest.alertDistribution', 'Alert Distribution')}
            </Caption>
            {pieData.length > 0 ? (
              <div
                className="h-56 w-full sm:h-64"
                role="img"
                aria-label={t(
                  'analytics.weeklyDigest.alertDistributionChartLabel',
                  'Pie chart of alerts by severity',
                )}
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
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — alerts exist but carry no severity breakdown to chart */
                icon={<AlertTriangle className="h-8 w-8" />}
                message={t(
                  'analytics.weeklyDigest.noAlertBreakdown',
                  'No severity breakdown to chart.',
                )}
                className="py-8"
              />
            )}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
