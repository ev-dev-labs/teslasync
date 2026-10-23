import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, AlertTriangle, Info, AlertOctagon, CheckCircle } from 'lucide-react';
import { useAlerts } from '@/api/hooks/useNotifications';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed, type EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import { normalizeSeverity, type Severity } from '@/lib/tokens';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';
import { useDataState } from '@/hooks/useDataState';
import { Caption } from '@/components/ui';

const SEVERITY_HEX: Record<Severity, string> = {
  info: '#0ea5e9',
  warn: '#f59e0b',
  critical: '#ef4444',
  success: '#10b981',
};

const SEVERITY_ICONS: Record<Severity, React.ReactNode> = {
  info: <Info className="h-3.5 w-3.5" />,
  warn: <AlertTriangle className="h-3.5 w-3.5" />,
  critical: <AlertOctagon className="h-3.5 w-3.5" />,
  success: <CheckCircle className="h-3.5 w-3.5" />,
};

export default function AlertFeedWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const query = useAlerts();
  const { data: alerts, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const state = useDataState({ ...query, data: alerts ?? undefined }, { provenance: 'historical' });

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  const items: EventFeedItem[] = useMemo(() =>
    (alerts ?? []).map(a => {
      const sev = normalizeSeverity(a.severity);
      return {
        id: a.id,
        icon: SEVERITY_ICONS[sev],
        title: a.title ?? '—',
        timestamp: a.created_at,
        color: SEVERITY_HEX[sev],
        href: getAlertDrillthroughHref(a),
        wrap: true,
      };
    }),
    [alerts],
  );

  const unreadCount = useMemo(
    () => (alerts ?? []).filter((alert) => !alert.is_read).length,
    [alerts],
  );

  const attentionCount = useMemo(
    () => (alerts ?? []).filter((alert) => {
      if (alert.is_read) return false;
      const severity = normalizeSeverity(alert.severity);
      return severity === 'warn' || severity === 'critical';
    }).length,
    [alerts],
  );

  const footerSummary = attentionCount > 0
    ? t(
        attentionCount === 1
          ? 'widget.alertFeedNeedsAttention_one'
          : 'widget.alertFeedNeedsAttention_other',
        attentionCount === 1 ? '{{count}} needs attention' : '{{count}} need attention',
        { count: attentionCount },
      )
    : unreadCount > 0
      ? t('widget.alertFeedUnread', '{{count}} unread', { count: unreadCount })
      : t('widget.alertFeedNoUnread', 'No unread alerts');

  return (
    <WidgetShell
      title={t('widget.alertFeed', 'Alert feed')}
      icon={<Bell className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={{ ...state, status: state.status === 'initial' && !isLoading ? 'unavailable' : state.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      footer={alerts !== undefined && alerts.length > 0 && isWide ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Caption className="min-w-0 text-[var(--text-muted)] tabular-nums">
            {footerSummary}
          </Caption>
          <Link
            to="/notifications/inbox"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
          >
            {t('widget.allAlerts', 'All alerts')}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      ) : undefined}
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
