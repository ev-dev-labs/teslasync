import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, AlertTriangle, Info, AlertOctagon } from 'lucide-react';
import { useAlerts } from '@/api/hooks/useNotifications';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed, type EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import type { Alert } from '@/api/types';

const SEVERITY_MAP: Record<Alert['severity'], { icon: React.ReactNode; color: string; label: string }> = {
  info:     { icon: <Info className="h-3.5 w-3.5" />,          color: '#3b82f6', label: 'Info' },
  warning:  { icon: <AlertTriangle className="h-3.5 w-3.5" />, color: '#f59e0b', label: 'Warning' },
  critical: { icon: <AlertOctagon className="h-3.5 w-3.5" />,  color: '#ef4444', label: 'Critical' },
};

export default function AlertFeedWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: alerts, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useAlerts();

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  const items: EventFeedItem[] = useMemo(() =>
    (alerts ?? []).map(a => {
      const sev = SEVERITY_MAP[a.severity] ?? SEVERITY_MAP.info;
      return {
        id: a.id,
        icon: sev.icon,
        title: a.title ?? '—',
        subtitle: isWide ? a.message : sev.label,
        timestamp: a.created_at,
        color: sev.color,
      };
    }),
    [alerts, isWide],
  );

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
      <WidgetEventFeed
        items={items}
        maxItems={isWide ? 12 : isTall ? 8 : 5}
        emptyIcon={<Bell className="h-5 w-5" />}
        emptyMessage={t('widget.noAlerts', 'No alerts yet')}
      />
    </WidgetShell>
  );
}
