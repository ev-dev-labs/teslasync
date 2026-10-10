import { useEffect, useMemo, useRef } from 'react';
import { AlertTriangle, BellOff, BellRing, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePriorityAlerts } from '@/api/hooks/useNotifications';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PanelTitle, Text } from '@/components/ui/Typography';
import { Popover } from '@/components/ui/Popover';
import { Tooltip } from '@/components/ui/Tooltip';
import { PrefetchLink } from '../PrefetchLink';
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough';
import { cn } from '@/lib/cn';
import { normalizeSeverity, severityTokens, typography } from '@/lib/tokens';
import {
  useStatusBarAnnouncer,
  useStatusBarPopover,
} from './StatusBarContext';

const PREVIEW_LIMIT = 4;

export interface AlertsSegmentProps {
  iconOnly?: boolean;
}

export function AlertsSegment({ iconOnly = false }: AlertsSegmentProps) {
  const { t } = useTranslation();
  const {
    data: prioritySnapshot,
    isError,
    isSuccess,
  } = usePriorityAlerts();
  const alerts = useMemo(
    () =>
      (prioritySnapshot?.alerts ?? [])
        .filter((alert) => {
          const severity = normalizeSeverity(alert.severity);
          return !alert.is_read && (severity === 'warn' || severity === 'critical');
        })
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
    [prioritySnapshot?.alerts],
  );
  const count = prioritySnapshot?.count ?? alerts.length;
  const hasMore = prioritySnapshot?.hasMore ?? false;
  const countDisplay = hasMore ? `${count}+` : String(count);
  const preview = alerts.slice(0, PREVIEW_LIMIT);
  const hasCritical = alerts.some(
    (alert) => normalizeSeverity(alert.severity) === 'critical',
  );
  const { open, toggle, close } = useStatusBarPopover('alerts');
  const announce = useStatusBarAnnouncer();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const hasInitializedAlerts = useRef(false);
  const previousCriticalIds = useRef(new Set<number>());
  const previousError = useRef(isError);

  useEffect(() => {
    if (!isSuccess) return;
    const currentCritical = alerts.filter(
      (alert) => normalizeSeverity(alert.severity) === 'critical',
    );
    if (!hasInitializedAlerts.current) {
      hasInitializedAlerts.current = true;
      previousCriticalIds.current = new Set(
        currentCritical.map((alert) => alert.id),
      );
      return;
    }
    const newCritical = currentCritical.find(
      (alert) => !previousCriticalIds.current.has(alert.id),
    );
    if (newCritical) {
      announce?.(
        t('statusBar.alerts.newCritical', 'Critical alert: {{title}}', {
          title: newCritical.title,
        }),
      );
    }
    previousCriticalIds.current = new Set(currentCritical.map((alert) => alert.id));
  }, [alerts, announce, isSuccess, t]);

  useEffect(() => {
    if (isError && !previousError.current) {
      announce?.(
        t(
          'statusBar.alerts.unavailableAria',
          'Priority alert monitoring is unavailable',
        ),
      );
    }
    previousError.current = isError;
  }, [announce, isError, t]);

  useEffect(() => {
    if (!isError && alerts.length === 0) close();
  }, [alerts.length, close, isError]);

  if (!isError && alerts.length === 0) return null;

  const countLabel = hasMore
    ? t(
        'statusBar.alerts.countMore',
        '{{count}}+ unread alerts',
        { count },
      )
    : t('statusBar.alerts.count', '{{count}} unread alerts', { count });
  const title = t('statusBar.alerts.title', 'Priority alerts');
  const criticalLabel = t(
    'statusBar.alerts.severity.critical',
    'Critical',
  );
  const warningLabel = t(
    'statusBar.alerts.severity.warning',
    'Warning',
  );
  const highestSeverity = hasCritical ? criticalLabel : warningLabel;
  const unavailableLabel = t(
    'statusBar.alerts.unavailableAria',
    'Priority alert monitoring is unavailable',
  );
  const triggerLabel = isError
    ? unavailableLabel
    : hasMore
      ? t(
          'statusBar.alerts.openMoreWithSeverity',
          'Open {{count}}+ unread alerts. Highest severity: {{severity}}',
          {
            count,
            severity: highestSeverity,
          },
        )
      : t(
          'statusBar.alerts.openWithSeverity',
          'Open {{count}} unread alerts. Highest severity: {{severity}}',
          {
            count,
            severity: highestSeverity,
          },
        );

  return (
    <>
      <Tooltip
        content={
          isError
            ? unavailableLabel
            : `${title} · ${countLabel} · ${highestSeverity}`
        }
        side="top"
      >
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={triggerLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 leading-none',
            typography.size.xs,
            isError || hasCritical ? severityTokens.critical.fg : severityTokens.warn.fg,
          )}
          data-testid="status-bar-alerts-trigger"
        >
          {isError ? (
            <Icon icon={BellOff} size="xs" />
          ) : hasCritical ? (
            <Icon icon={AlertTriangle} size="xs" />
          ) : (
            <Icon icon={BellRing} size="xs" />
          )}
          {!iconOnly && (
            <Text as="span" size="xs" weight="medium">
              {isError
                ? t('statusBar.alerts.unavailable', 'Alerts unavailable')
                : t('statusBar.alerts.short', 'Alerts')}
            </Text>
          )}
          {!isError && (
            <Badge
              variant={hasCritical ? 'danger' : 'warning'}
              size="sm"
              className="h-4 min-w-4 justify-center px-1 py-0 tabular-nums"
              aria-hidden
            >
              {countDisplay}
            </Badge>
          )}
        </Button>
      </Tooltip>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        side="top"
        align="end"
        ariaLabel={title}
        className="w-alerts-preview p-2"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-2 pb-2 pt-1">
          <div>
            <PanelTitle>{title}</PanelTitle>
            <Text as="p" size="xs" color="muted" className="mt-0.5">
              {isError ? unavailableLabel : countLabel}
            </Text>
          </div>
          {isError ? (
            <Icon icon={BellOff} className={severityTokens.critical.fg} />
          ) : (
            <Icon icon={BellRing} className={typography.color.secondary} />
          )}
        </div>

        {isError && (
          <div className="px-2 py-3">
            <Text as="p" size="sm" color="secondary">
              {t(
                'statusBar.alerts.unavailableDetail',
                'The latest priority alerts could not be refreshed.',
              )}
            </Text>
          </div>
        )}
        {preview.length > 0 && (
          <ul className="max-h-alerts-preview space-y-0.5 overflow-y-auto py-1">
            {preview.map((alert) => {
              const critical = normalizeSeverity(alert.severity) === 'critical';
              const severityLabel = critical ? criticalLabel : warningLabel;
              return (
                <li key={alert.id}>
                  <PrefetchLink
                    to={getAlertDrillthroughHref(alert)}
                    onClick={close}
                    className="flex min-h-12 items-start gap-2 rounded-md px-2 py-2 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  >
                    <Badge
                      variant={critical ? 'danger' : 'warning'}
                      size="sm"
                      className="mt-0.5 shrink-0 px-1.5 py-0"
                    >
                      {severityLabel}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <Text
                        as="span"
                        size="sm"
                        weight="medium"
                        color="primary"
                        className="block break-words"
                      >
                        {alert.title}
                      </Text>
                      <Text
                        as="span"
                        size="xs"
                        color="muted"
                        className="mt-0.5 block break-words"
                      >
                        {alert.message}
                      </Text>
                    </span>
                    <Icon
                      icon={ChevronRight}
                      size="sm"
                      className={cn('mt-1 rtl:rotate-180', typography.color.muted)}
                    />
                  </PrefetchLink>
                </li>
              );
            })}
          </ul>
        )}

        <div className="border-t border-[var(--border-subtle)] px-2 pt-2">
          <PrefetchLink
            to="/notifications/inbox?read=unread"
            onClick={close}
            className={cn(
              typography.size.xs,
              typography.weight.medium,
              typography.color.primary,
              'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]',
            )}
          >
            {t('statusBar.alerts.viewAll', 'View all alerts')}
          </PrefetchLink>
        </div>
      </Popover>
    </>
  );
}
