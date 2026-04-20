import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, AlertTriangle, Info, AlertOctagon } from 'lucide-react';
import { TimelineItem } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useAlerts } from '@/api/hooks/useNotifications';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Alert } from '@/api/types';

const SEVERITY_MAP: Record<Alert['severity'], { icon: React.ReactNode; color: string; label: string }> = {
  info:     { icon: <Info className="h-3.5 w-3.5" />,          color: '#3b82f6', label: 'Info' },
  warning:  { icon: <AlertTriangle className="h-3.5 w-3.5" />, color: '#f59e0b', label: 'Warning' },
  critical: { icon: <AlertOctagon className="h-3.5 w-3.5" />,  color: '#ef4444', label: 'Critical' },
};

function formatAlertTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildSubtitle(alert: Alert, isWide: boolean): string {
  const sev = SEVERITY_MAP[alert.severity] ?? SEVERITY_MAP.info;
  const parts: string[] = [sev.label];
  if (isWide && alert.message) parts.push(alert.message);
  return parts.join(' · ');
}

export default function AlertFeedWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: alerts, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useAlerts();

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;
  const displayLimit = isWide ? 12 : isTall ? 8 : 5;

  const items = useMemo(() => {
    const list = alerts ?? [];
    return [...list]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, displayLimit);
  }, [alerts, displayLimit]);

  return (
    <WidgetShell
      title={t('widget.alertFeed', 'Alert Feed')}
      icon={<Bell className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      <div className="space-y-0 overflow-y-auto h-full">
        {items.length > 0 ? (
          items.map((alert, i) => {
            const sev = SEVERITY_MAP[alert.severity] ?? SEVERITY_MAP.info;
            return (
              <TimelineItem
                key={alert.id}
                icon={sev.icon}
                title={alert.title ?? '—'}
                subtitle={buildSubtitle(alert, isWide)}
                time={formatAlertTime(alert.created_at)}
                color={sev.color}
                isLast={i === items.length - 1}
              />
            );
          })
        ) : (
          <EmptyState
            icon={<Bell className="h-5 w-5" />}
            message={t('widget.noAlerts', 'No alerts yet')}
            className="py-4"
          />
        )}
      </div>
    </WidgetShell>
  );
}
