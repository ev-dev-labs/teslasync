import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { GlassPanel, Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip, CHART_COLORS,
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend,
} from '@/components/charts';
import { fmtInt } from '@/lib/numberFormat';
import { STATUS_COLORS } from '@/lib/colors';
import type { DigestMetrics, AlertPieEntry } from './types';

interface AlertsSectionProps {
  metrics: DigestMetrics;
  alertPieData: AlertPieEntry[];
}

export function AlertsSection({ metrics, alertPieData }: AlertsSectionProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.25}>
      <GlassPanel className="space-y-6 p-6">
        <span className="flex items-center gap-2 text-lg font-bold text-white">
          <AlertTriangle className="h-5 w-5 text-neon-amber" />
          {t('analytics.weeklyDigest.alertsSection', 'Alerts')}
          {metrics.alertTotal > 0 && (
            <Badge variant="warning" size="sm">
              {fmtInt(metrics.alertTotal)}
            </Badge>
          )}
        </span>

        {metrics.alertTotal === 0 ? (
          <EmptyState
            icon={<AlertTriangle className="h-8 w-8" />}
            message={t(
              'analytics.weeklyDigest.noAlerts',
              'No alerts this week — everything looks great!',
            )}
            className="py-8"
          />
        ) : (
          <span className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Alert count by severity */}
            <span className="space-y-3">
              <span className="text-sm font-medium text-white/70">
                {t('analytics.weeklyDigest.alertsBySeverity', 'Alerts by Severity')}
              </span>
              <span className="grid gap-3">
                {Object.entries(metrics.alertsByType).map(([severity, count]) => (
                  <GlassPanel
                    key={severity}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <span className="flex items-center gap-2">
                      {severity === 'critical' && (
                        <AlertCircle
                          className="h-4 w-4"
                          style={{ color: STATUS_COLORS.critical }}
                        />
                      )}
                      {severity === 'warning' && (
                        <AlertTriangle
                          className="h-4 w-4"
                          style={{ color: STATUS_COLORS.warning }}
                        />
                      )}
                      {severity === 'info' && (
                        <Info
                          className="h-4 w-4"
                          style={{ color: CHART_COLORS[0] }}
                        />
                      )}
                      <span className="text-sm capitalize text-white/80">{severity}</span>
                    </span>
                    <Badge
                      variant={
                        severity === 'critical'
                          ? 'danger'
                          : severity === 'warning'
                            ? 'warning'
                            : 'info'
                      }
                      size="sm"
                    >
                      {fmtInt(count)}
                    </Badge>
                  </GlassPanel>
                ))}
              </span>
            </span>

            {/* Alert distribution PieChart */}
            <span className="flex flex-col items-center">
              <span className="mb-3 text-sm font-medium text-white/70">
                {t('analytics.weeklyDigest.alertDistribution', 'Alert Distribution')}
              </span>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={alertPieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {alertPieData.map((entry) => (
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
            </span>
          </span>
        )}
      </GlassPanel>
    </FadeIn>
  );
}
