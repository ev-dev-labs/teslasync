import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell, AlertTriangle, Info, AlertOctagon, CheckCircle } from 'lucide-react';
import { useAlerts } from '@/api/hooks/useNotifications';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed, type EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import { normalizeSeverity, type Severity } from '@/lib/tokens';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';

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
  const { data: alerts, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useAlerts();

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  // User-visible severity labels must go through i18n (module scope can't call
  // `t`). Memoised so the map identity only changes when the language does.
  const severityLabels = useMemo<Record<Severity, string>>(() => ({
    info: t('widget.severity.info', 'Info'),
    warn: t('widget.severity.warn', 'Warning'),
    critical: t('widget.severity.critical', 'Critical'),
    success: t('widget.severity.success', 'Success'),
  }), [t]);

  const items: EventFeedItem[] = useMemo(() =>
    (alerts ?? []).map(a => {
      const sev = normalizeSeverity(a.severity);
      const label = severityLabels[sev];
      return {
        id: a.id,
        icon: SEVERITY_ICONS[sev],
        title: a.title ?? '—',
        // Wide widgets show the alert message; fall back to the severity label
        // so a row with an empty/degraded message is never left contextless.
        subtitle: isWide ? (a.message || label) : label,
        timestamp: a.created_at,
        color: SEVERITY_HEX[sev],
        href: getAlertDrillthroughHref(a),
      };
    }),
    [alerts, isWide, severityLabels],
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
