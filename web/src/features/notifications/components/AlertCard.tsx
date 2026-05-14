/**
 * AlertCard — single alert row used by AlertsListPage.
 *
 * Was previously an inner component of the now-removed AlertsPage. Owns
 * presentation only — the hosting page wires up mark-read / acknowledge /
 * reopen / open-detail actions via callbacks so the card is reusable in
 * future surfaces (rule preview, drillthrough, etc.).
 */

import { Link } from 'react-router-dom';
import type { TFunction } from 'i18next';
import { cn } from '@/lib/cn';
import { severityTokens, normalizeSeverity } from '@/lib/tokens';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SeverityBadge } from '@/components/data-display/SeverityBadge';
import { StatusDot } from '@/components/data-display/StatusDot';
import { Icons } from '@/lib/icons';
import type { Alert } from '@/api/types';

const TYPE_ICONS: Record<string, React.ElementType> = {
  geofence_exit: Icons.location, geofence_enter: Icons.location,
  low_battery: Icons.battery, battery_low: Icons.battery, battery_high: Icons.battery,
  charging_complete: Icons.charging, charging_cost: Icons.charging,
  sentry_event: Icons.security, speed_limit: Icons.speed, temperature: Icons.climate,
  software_update: Icons.settingsAlt, vampire_drain: Icons.trendDown,
  tire_pressure_low: Icons.droplets, idle_unlocked: Icons.locked, efficiency_drop: Icons.analytics,
  system_database: Icons.database, system_mqtt: Icons.wifi, system_redis: Icons.hardDrive,
  system_tesla_api: Icons.radio, system_worker: Icons.efficiency,
};

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface AlertCardProps {
  alert: Alert;
  onMarkRead: () => void;
  onAcknowledge: () => void;
  onOpenDetail: () => void;
  onReopen: () => void;
  t: TFunction;
}

export function AlertCard({ alert, onMarkRead, onAcknowledge, onOpenDetail, onReopen, t }: AlertCardProps) {
  const sev = normalizeSeverity(alert.severity);
  const tokens = severityTokens[sev];
  const Icon = TYPE_ICONS[alert.type] || Icons.notifications;
  const timeAgo = getTimeAgo(alert.created_at);
  const drillHref = getAlertDrillthroughHref(alert);
  const isAcked = Boolean(alert.acknowledged_at);

  return (
    <GlassPanel
      className={cn(
        'p-4 flex items-start gap-4 transition-all duration-normal group',
        !alert.is_read && cn(tokens.border, tokens.bg.replace('/10', '/5')),
      )}
    >
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={cn('rounded-xl p-2.5 ring-1', tokens.bg, tokens.border)}>
          <Icon className={cn('h-4 w-4', tokens.fg)} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <Link
            to={drillHref}
            className="block min-w-0 flex-1 -m-1 p-1 rounded-md hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400/60"
            aria-label={t('alerts.viewContext', 'View context')}
          >
            <span className={cn('text-sm font-medium block', alert.is_read ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>
              {alert.title}
            </span>
            <span className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2 block">{alert.message}</span>
          </Link>
          {!alert.is_read && (
            <StatusDot
              severity={alert.severity}
              className="mt-1.5 shrink-0 animate-pulse"
              label={t('Unread')}
            />
          )}
        </div>
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
            <Icons.clock className="h-2.5 w-2.5" />{timeAgo}
          </span>
          <SeverityBadge severity={alert.severity} size="sm" showIcon={false}>
            {alert.severity}
          </SeverityBadge>
          <span className="text-[10px] text-[var(--text-muted)]">{(alert.type ?? 'notification').replace(/_/g, ' ')}</span>
          {isAcked && (
            <Badge variant="success" size="sm">
              {alert.acknowledged_by
                ? t('alerts.ack.ackedBy', 'Acknowledged by {{actor}}', { actor: alert.acknowledged_by })
                : t('alerts.ack.ackedByAnonymous', 'Acknowledged')}
            </Badge>
          )}
          <Link
            to={drillHref}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-cyan-300 hover:text-cyan-200 underline-offset-2 hover:underline opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {t('alerts.viewContext', 'View context')}
            <Icons.next className="h-3 w-3" />
          </Link>
          <Button
            variant="ghost"
            size="sm"
            icon={<Icons.notifications className="h-3 w-3" />}
            onClick={onOpenDetail}
          >
            {t('alerts.timeline.title', 'Audit timeline')}
          </Button>
          {isAcked ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Icons.refresh className="h-3 w-3" />}
              onClick={onReopen}
            >
              {t('alerts.timeline.kindAnonymous.reopened', 'Reopened')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={<Icons.success className="h-3 w-3" />}
              onClick={onAcknowledge}
            >
              {t('alerts.ack.button', 'Acknowledge')}
            </Button>
          )}
          {!alert.is_read && (
            <Button variant="ghost" size="sm" icon={<Icons.show className="h-3 w-3" />} onClick={onMarkRead}>
              {t('Mark read')}
            </Button>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

export default AlertCard;
