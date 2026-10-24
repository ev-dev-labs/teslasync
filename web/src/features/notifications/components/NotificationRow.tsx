/**
 * NotificationRow — one inbox row.
 *
 * Renders:
 *   - Selection checkbox
 *   - Persisted severity (unknown values retain their raw label)
 *   - Time   (disclosed user timezone, consistent across inbox vehicles)
 *   - Title  (from notification log)
 *   - Vehicle name (when known)
 *   - Drill-through link (uses `getAlertDrillthroughHref`)
 *
 * Unread rows get a left-edge accent bar and slightly stronger background so
 * the inbox visually telegraphs which rows are still pending attention.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, ArchiveRestore, ChevronRight, MailOpen, Mail } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DateTime, SeverityBadge } from '@/components/data-display';
import { Badge, Button, BUTTON_BASE, Caption, Checkbox, Text } from '@/components/ui';
import { typography } from '@/lib/tokens';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';
import type { NotificationLog, AlertRule, Alert, Vehicle } from '@/api/types';

export interface NotificationRowProps {
  log: NotificationLog;
  rule?: AlertRule;
  vehicle?: Vehicle;
  selected: boolean;
  onSelectionChange: (id: number, selected: boolean) => void;
  /** Fires when the user clicks anywhere on the row body (not on controls). */
  onActivate?: (log: NotificationLog) => void;
  /** Quick per-row archive/unarchive button. */
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  /** Quick per-row mark read/unread button. */
  onMarkRead?: (id: number) => void;
  onMarkUnread?: (id: number) => void;
}

export function NotificationRow({
  log,
  rule,
  vehicle,
  selected,
  onSelectionChange,
  onActivate,
  onArchive,
  onUnarchive,
  onMarkRead,
  onMarkUnread,
}: NotificationRowProps) {
  const { t } = useTranslation();
  const isRead = !!log.read_at;
  const isArchived = !!log.archived_at;
  const severity = log.severity;
  const knownSeverity = severity === 'warning' ? 'warn'
    : severity === 'info' || severity === 'warn' || severity === 'critical' ? severity
    : null;
  const severityLabel = knownSeverity === 'info'
    ? t('notifications.inbox.filter.severity.info', 'Info')
    : knownSeverity === 'warn'
      ? t('notifications.inbox.filter.severity.warn', 'Warn')
      : knownSeverity === 'critical'
        ? t('notifications.inbox.filter.severity.critical', 'Critical')
        : severity || '—';
  // A blank/absent title would otherwise render an empty primary line. Degrade
  // to an em-dash so the row never collapses to a headless body (matches the
  // sibling AlertCard behavior). `||` (not `??`) so empty strings degrade too.
  const displayTitle = log.title || '—';

  const synthetic: Alert = {
    id: log.id,
    vehicle_id: vehicle?.id ?? rule?.vehicle_id ?? 0,
    type: rule?.name ?? log.title,
    severity: severity ?? '',
    title: log.title,
    message: log.message,
    is_read: isRead,
    created_at: log.created_at,
    rule_id: rule?.id,
    rule_signal: rule?.signal_name,
    rule_severity: rule?.severity,
  };

  const drillHref = rule ? getAlertDrillthroughHref(synthetic) : null;
  // DateTime's vehicle mode follows workspace selection, not this row's vehicle.
  // Use one disclosed inbox timezone rather than implying a different identity.

  return (
    <div
      role="group"
      aria-label={displayTitle}
      className={cn(
        'group relative flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-fast motion-reduce:transition-none',
        'border-[var(--border-default)] hover:bg-[var(--control-bg-hover)]',
        !isRead && 'bg-[var(--surface-2)] border-l-2 border-l-[var(--text-secondary)]',
      )}
    >
      <Checkbox
        checked={selected}
        onChange={checked => onSelectionChange(log.id, checked)}
        aria-label={t('notifications.inbox.row.select', 'Select notification')}
        className="mt-1"
      />

      <Button
        type="button"
        variant="ghost"
        onClick={() => onActivate?.(log)}
        aria-label={t('notifications.inbox.row.open', 'Open notification: {{title}}', { title: displayTitle })}
        className="!h-auto min-w-0 flex-1 !justify-start !p-0 text-left !font-normal"
      >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {knownSeverity ? (
            <SeverityBadge severity={knownSeverity} size="sm" showIcon={false}>
              {severityLabel}
            </SeverityBadge>
          ) : (
            <Badge variant="neutral" size="sm">{severityLabel}</Badge>
          )}
          <DateTime
            value={log.created_at}
            in="user"
            className={cn('whitespace-nowrap', typography.role.caption)}
          />
          {vehicle && (
            <Caption className="truncate">
              · {vehicle.display_name || `#${vehicle.id}`}
            </Caption>
          )}
          {rule?.name && (
            <Caption className="truncate">
              · {rule.name}
            </Caption>
          )}
          {log.event_type && (
            <Caption className="truncate">
              · {log.event_type}
            </Caption>
          )}
          {!isRead && <Badge variant="neutral" size="sm">{t('notifications.inbox.columns.unread', 'Unread')}</Badge>}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <Text variant={isRead ? 'bodySm' : 'body'} className={cn('truncate', !isRead && typography.weight.medium)}>
            {displayTitle}
          </Text>
        </div>
        {log.message && (
          <Caption as="p" className="mt-0.5 line-clamp-1">
            {log.message}
          </Caption>
        )}
      </div>
      </Button>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-fast motion-reduce:transition-none group-hover:opacity-100 focus-within:opacity-100">
        {!isRead && onMarkRead && (
          <Button
            variant="ghost"
            size="sm"
            icon={<MailOpen className="h-3.5 w-3.5" />}
            aria-label={t('notifications.inbox.row.markRead', 'Mark as read')}
            onClick={() => onMarkRead(log.id)}
          />
        )}
        {isRead && onMarkUnread && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Mail className="h-3.5 w-3.5" />}
            aria-label={t('notifications.inbox.row.markUnread', 'Mark as unread')}
            onClick={() => onMarkUnread(log.id)}
          />
        )}
        {!isArchived && onArchive && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Archive className="h-3.5 w-3.5" />}
            aria-label={t('notifications.inbox.row.archive', 'Archive')}
            onClick={() => onArchive(log.id)}
          />
        )}
        {isArchived && onUnarchive && (
          <Button
            variant="ghost"
            size="sm"
            icon={<ArchiveRestore className="h-3.5 w-3.5" />}
            aria-label={t('notifications.inbox.row.unarchive', 'Restore')}
            onClick={() => onUnarchive(log.id)}
          />
        )}
        {drillHref && (
          <Link
            to={drillHref}
            className={cn(BUTTON_BASE, typography.role.caption, 'px-2 py-1 hover:bg-[var(--control-bg-hover)]')}
            aria-label={t('alerts.viewContext', 'View context')}
          >
            <span className="hidden sm:inline">{t('alerts.viewContext', 'View context')}</span>
            <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </div>
  );
}
