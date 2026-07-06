/**
 * NotificationRow — one inbox row.
 *
 * Renders:
 *   - Selection checkbox
 *   - Severity dot (colored disc, color from rule severity if known)
 *   - Time   (vehicle-tz when vehicle is known, else user)
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
import { Button } from '@/components/ui';
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
  const severity = rule?.severity ?? 'info';
  // A blank/absent title would otherwise render an empty primary line. Degrade
  // to an em-dash so the row never collapses to a headless body (matches the
  // sibling AlertCard behavior). `||` (not `??`) so empty strings degrade too.
  const displayTitle = log.title || '—';

  const synthetic: Alert = {
    id: log.id,
    vehicle_id: vehicle?.id ?? rule?.vehicle_id ?? 0,
    type: rule?.name ?? log.title,
    severity: severity as Alert['severity'],
    title: log.title,
    message: log.message,
    is_read: isRead,
    created_at: log.created_at,
    rule_id: rule?.id,
    rule_signal: rule?.signal_name,
    rule_severity: rule?.severity,
  };

  const drillHref = rule ? getAlertDrillthroughHref(synthetic) : null;
  const tzMode = vehicle ? 'vehicle' : 'user';

  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      className={cn(
        'group relative flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        'border-white/[0.06] hover:bg-white/[0.04]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
        !isRead && 'bg-white/[0.03] border-l-2 border-l-cyan-400/70',
        isRead && 'opacity-90',
      )}
      onClick={(e) => {
        // Activate only when the click is on the row body (not on form controls
        // or the drill-through link, which already navigate or toggle).
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, label')) return;
        onActivate?.(log);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          const target = e.target as HTMLElement;
          if (target.closest('button, a, input, label')) return;
          e.preventDefault();
          onActivate?.(log);
        }
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={e => onSelectionChange(log.id, e.target.checked)}
        aria-label={t('notifications.inbox.row.select', 'Select notification')}
        className="mt-1 h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-white/[0.04] text-cyan-500 focus:ring-2 focus:ring-cyan-500"
      />

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={severity} size="sm" showIcon={false}>
            {severity}
          </SeverityBadge>
          <DateTime
            value={log.created_at}
            in={tzMode}
            className="whitespace-nowrap text-xs text-[var(--text-muted)]"
          />
          {vehicle && (
            <span className="truncate text-xs text-[var(--text-muted)]">
              · {vehicle.display_name || `#${vehicle.id}`}
            </span>
          )}
          {rule?.name && (
            <span className="truncate text-xs text-[var(--text-muted)]">
              · {rule.name}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className={cn(
            'truncate text-sm',
            isRead ? 'text-[var(--text-secondary)]' : 'font-medium text-[var(--text-primary)]',
          )}>
            {displayTitle}
          </span>
        </div>
        {log.message && (
          <p className="mt-0.5 line-clamp-1 text-xs text-[var(--text-muted)]">
            {log.message}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-cyan-300 hover:bg-white/[0.06] hover:text-cyan-200"
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
