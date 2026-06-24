import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useAlertRules,
  useAlerts,
  useNotificationChannels,
  useNotificationLogs,
  useNotificationStats,
  useQuietHours,
} from '../api/hooks';
import type {
  AlertRule,
  NotificationChannel,
  NotificationLog,
  QuietHoursWindow,
} from '../api/types';
import { KeyValueRow } from '../components/data/KeyValueRow';
import { ListRow } from '../components/data/ListRow';
import {
  RouteReadinessPanel,
  type RouteReadinessItem,
} from '../components/data/RouteReadinessPanel';
import { ScreenSection } from '../components/data/ScreenSection';
import { EmptyState } from '../components/feedback/EmptyState';
import { AppText } from '../components/ui/AppText';
import { GlassPanel } from '../components/ui/GlassPanel';
import { StatusPill } from '../components/ui/StatusPill';
import { formatBoolean, formatCount, formatDateTime } from '../lib/format';
import { colors, spacing } from '../theme/tokens';

const weekdayLabels = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

const notificationRouteItems: RouteReadinessItem[] = [
  {
    id: 'alert-studio',
    label: 'Legacy alert studio redirect',
    route: '/alert-studio',
    api: '/alerts/rules, /notifications, write endpoints disabled',
    status: 'implemented',
    evidence:
      'Native renders rule inventory, delivery channel context, and disabled studio actions instead of allowing unvalidated rule writes.',
  },
  {
    id: 'alert-rules',
    label: 'Legacy alert rules redirect',
    route: '/alert-rules',
    api: '/alerts/rules',
    status: 'implemented',
    evidence:
      'Native renders alert rules read-only with severity, trigger, vehicle target, cooldown, and snooze metadata.',
  },
  {
    id: 'notifications-browser',
    label: 'Browser and push notifications',
    route: '/notifications/browser',
    api: '/notifications/stats, native push unavailable',
    status: 'implemented',
    evidence:
      'Native exposes in-app delivery stats and explicitly marks APNs, FCM, WNS, badge, and browser push registration unavailable.',
  },
  {
    id: 'notifications-rules',
    label: 'Notification rules',
    route: '/notifications/rules',
    api: '/alerts/rules',
    status: 'implemented',
    evidence:
      'Native maps notification rule parity to the API-backed alert rule inventory while create, edit, snooze, and test sends stay disabled.',
  },
  {
    id: 'notifications-studio',
    label: 'Notification studio',
    route: '/notifications/studio',
    api: '/notifications, /notifications/logs, write endpoints disabled',
    status: 'implemented',
    evidence:
      'Native renders studio readiness with no fake notification success; test sends and channel mutations remain unavailable.',
  },
];

function statusState(
  value: string | null | undefined,
): 'online' | 'warning' | 'offline' {
  const normalized = value?.toLowerCase();
  if (
    normalized === 'critical' ||
    normalized === 'failed' ||
    normalized === 'error'
  ) {
    return 'offline';
  }
  if (
    normalized === 'warn' ||
    normalized === 'warning' ||
    normalized === 'pending' ||
    normalized === 'deferred_dnd'
  ) {
    return 'warning';
  }
  return 'online';
}

function notificationChannelKind(channel: NotificationChannel): string {
  return channel.type ?? channel.kind ?? 'unknown';
}

function formatWeekdays(mask: number): string {
  const enabledDays = weekdayLabels.filter((_, index) => {
    const bit = 2 ** index;
    return Math.floor(mask / bit) % 2 === 1;
  });
  if (enabledDays.length === 7) {
    return 'Every day';
  }
  if (enabledDays.length === 0) {
    return 'No days selected';
  }
  return enabledDays.join(', ');
}

function formatRuleTarget(rule: AlertRule): string {
  if (rule.all_vehicles) {
    return 'All vehicles';
  }
  if ((rule.vehicle_ids ?? []).length > 0) {
    return `${rule.vehicle_ids?.length ?? 0} selected vehicles`;
  }
  if (rule.vehicle_id != null) {
    return `Vehicle ${rule.vehicle_id}`;
  }
  return 'No vehicle target';
}

function formatRuleOperand(rule: AlertRule): string {
  if (rule.kind === 'computed_metric') {
    return [rule.metric_id, rule.metric_op, rule.metric_threshold]
      .filter(value => value != null && value !== '')
      .join(' ');
  }

  if (rule.op === 'changed') {
    return `${rule.signal_name} changed`;
  }
  if (rule.op === 'between' || rule.op === 'outside') {
    return `${rule.signal_name} ${rule.op} ${rule.value_min ?? '-'}-${
      rule.value_max ?? '-'
    }`;
  }
  if (rule.value_num != null) {
    return `${rule.signal_name} ${rule.op} ${rule.value_num}`;
  }
  if (rule.value_bool != null) {
    return `${rule.signal_name} ${rule.op} ${
      rule.value_bool ? 'true' : 'false'
    }`;
  }
  if (rule.value_text) {
    return `${rule.signal_name} ${rule.op} ${rule.value_text}`;
  }
  return `${rule.signal_name} ${rule.op}`;
}

function isFutureTimestamp(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function NotificationLogRow({ log }: { log: NotificationLog }) {
  const unread = !log.read_at;
  return (
    <ListRow
      title={log.title || `Notification ${log.id}`}
      subtitle={log.message || 'No notification message provided.'}
      meta={formatDateTime(log.created_at)}
      icon={unread ? 'notificationsActive' : 'notifications'}
      detail={
        <View style={styles.rowDetail}>
          <StatusPill
            label={log.severity || log.status || 'info'}
            state={statusState(log.severity || log.status)}
          />
          <StatusPill
            label={unread ? 'Unread' : 'Read'}
            state={unread ? 'warning' : 'online'}
          />
          <AppText variant="caption" tone="muted">
            Channel {log.channel_id} • {log.status}
          </AppText>
          {log.error ? (
            <AppText variant="caption" tone="danger">
              {log.error}
            </AppText>
          ) : null}
        </View>
      }
    />
  );
}

function AlertRuleRow({ rule }: { rule: AlertRule }) {
  const snoozed = isFutureTimestamp(rule.snoozed_until);
  return (
    <ListRow
      title={rule.name || `Rule ${rule.id}`}
      subtitle={rule.description ?? formatRuleOperand(rule)}
      meta={formatRuleTarget(rule)}
      icon={rule.enabled ? 'notificationsActive' : 'notificationsMuted'}
      detail={
        <View style={styles.rowDetail}>
          <StatusPill
            label={rule.enabled ? 'Enabled' : 'Disabled'}
            state={rule.enabled ? 'online' : 'warning'}
          />
          <StatusPill
            label={rule.severity}
            state={statusState(rule.severity)}
          />
          <AppText variant="caption" tone="muted">
            {formatRuleOperand(rule)}
          </AppText>
          <AppText variant="caption" tone="muted">
            {rule.trigger_mode} • cooldown {rule.cooldown_min} min
          </AppText>
          {snoozed ? (
            <AppText variant="caption" tone="accent">
              Snoozed until {formatDateTime(rule.snoozed_until)}
            </AppText>
          ) : null}
        </View>
      }
    />
  );
}

function ChannelRow({ channel }: { channel: NotificationChannel }) {
  const configKeys = Object.keys(channel.config ?? {}).length;
  return (
    <ListRow
      title={channel.name || `Channel ${channel.id}`}
      subtitle={`${notificationChannelKind(channel)} delivery channel`}
      meta={channel.enabled ? 'enabled' : 'disabled'}
      icon={channel.enabled ? 'send' : 'notificationsMuted'}
      detail={
        <View style={styles.rowDetail}>
          <StatusPill
            label={channel.enabled ? 'Enabled' : 'Disabled'}
            state={channel.enabled ? 'online' : 'warning'}
          />
          <AppText variant="caption" tone="muted">
            Config keys present: {formatCount(configKeys)}
          </AppText>
          <AppText variant="caption" tone="muted">
            Updated {formatDateTime(channel.updated_at)}
          </AppText>
        </View>
      }
    />
  );
}

function QuietHoursRow({ window }: { window: QuietHoursWindow }) {
  return (
    <ListRow
      title={`${window.start_local} - ${window.end_local}`}
      subtitle={`${formatWeekdays(window.weekdays)} in ${window.timezone}`}
      meta={window.enabled ? 'enabled' : 'disabled'}
      icon={window.enabled ? 'moon' : 'notificationsMuted'}
      detail={
        <View style={styles.rowDetail}>
          <StatusPill
            label={window.enabled ? 'Enabled' : 'Disabled'}
            state={window.enabled ? 'online' : 'warning'}
          />
          <AppText variant="caption" tone="muted">
            Bypass severities:{' '}
            {(window.bypass_severities ?? []).join(', ') || 'none'}
          </AppText>
        </View>
      }
    />
  );
}

export function AlertsScreen() {
  const alertsQuery = useAlerts();
  const inboxQuery = useNotificationLogs({ archived: false, limit: 10 });
  const archivedQuery = useNotificationLogs({ archived: true, limit: 5 });
  const auditQuery = useNotificationLogs({ limit: 12 });
  const rulesQuery = useAlertRules();
  const channelsQuery = useNotificationChannels();
  const statsQuery = useNotificationStats();
  const quietHoursQuery = useQuietHours();

  const alerts = alertsQuery.data ?? [];
  const inbox = inboxQuery.data ?? [];
  const archived = archivedQuery.data ?? [];
  const auditRows = auditQuery.data ?? [];
  const rules = rulesQuery.data ?? [];
  const channels = channelsQuery.data ?? [];
  const quietHours = quietHoursQuery.data ?? [];
  const stats = statsQuery.data;
  const enabledRules = rules.filter(rule => rule.enabled).length;
  const unreadNotifications = inbox.filter(log => !log.read_at).length;
  const enabledChannels = channels.filter(channel => channel.enabled).length;

  return (
    <View style={styles.root}>
      <GlassPanel style={styles.summaryPanel}>
        <View style={styles.summaryHeader}>
          <View style={styles.summaryCopy}>
            <AppText variant="title" weight="bold">
              Native notification platform
            </AppText>
            <AppText tone="secondary">
              Read-only parity for in-app inbox, alert rules, delivery channels,
              quiet hours, and native push readiness.
            </AppText>
          </View>
          <StatusPill
            label={statsQuery.error ? 'API unavailable' : 'API backed'}
            state={statsQuery.error ? 'offline' : 'online'}
          />
        </View>
        <View style={styles.metricGrid}>
          <KeyValueRow
            label="Unread inbox rows"
            value={formatCount(unreadNotifications)}
          />
          <KeyValueRow
            label="Rules enabled"
            value={`${formatCount(enabledRules)} / ${formatCount(
              rules.length,
            )}`}
          />
          <KeyValueRow
            label="Channels enabled"
            value={`${formatCount(enabledChannels)} / ${formatCount(
              channels.length,
            )}`}
          />
          <KeyValueRow
            label="Quiet-hours windows"
            value={formatCount(quietHours.length)}
          />
          <KeyValueRow
            label="Archived rows"
            value={formatCount(archived.length)}
          />
          <KeyValueRow
            label="Sent notifications"
            value={formatCount(stats?.sent)}
          />
          <KeyValueRow
            label="Failed notifications"
            value={formatCount(stats?.failed)}
          />
        </View>
      </GlassPanel>

      <ScreenSection
        title="Notification inbox"
        subtitle="Native read-only view over /notifications/logs with read, archived, and delivery status."
      >
        {inboxQuery.error ? (
          <EmptyState
            title="Notification inbox unavailable"
            message="The native client could not load /notifications/logs; no delivery success is assumed."
          />
        ) : inbox.length === 0 ? (
          <EmptyState
            title={
              inboxQuery.isLoading
                ? 'Loading notification inbox'
                : 'No notification rows returned'
            }
            message="Recent notification delivery rows will appear here when the backend returns inbox data."
          />
        ) : (
          <View style={styles.list}>
            {inbox.map(log => (
              <NotificationLogRow key={log.id} log={log} />
            ))}
          </View>
        )}
      </ScreenSection>

      <ScreenSection
        title="Archived notifications"
        subtitle="Native read-only view over /notifications/logs?archived=true for acknowledged delivery rows."
      >
        {archivedQuery.error ? (
          <EmptyState
            title="Archived notifications unavailable"
            message="The archived notification query could not be loaded; no archive state is assumed."
          />
        ) : archived.length === 0 ? (
          <EmptyState
            title={
              archivedQuery.isLoading
                ? 'Loading archived notifications'
                : 'No archived notification rows returned'
            }
            message="Archived notification rows will appear here after users archive inbox items."
          />
        ) : (
          <View style={styles.list}>
            {archived.map(log => (
              <NotificationLogRow key={log.id} log={log} />
            ))}
          </View>
        )}
      </ScreenSection>

      <ScreenSection
        title="Alert rules"
        subtitle="Native rule inventory from /alerts/rules; creation, edits, snooze, and test sends remain unavailable in this slice."
      >
        {rulesQuery.error ? (
          <EmptyState
            title="Alert rules unavailable"
            message="The rules endpoint returned an error; native write actions remain disabled."
          />
        ) : rules.length === 0 ? (
          <EmptyState
            title={
              rulesQuery.isLoading
                ? 'Loading alert rules'
                : 'No alert rules returned'
            }
            message="Enabled, disabled, and snoozed rules will appear here when configured."
          />
        ) : (
          <View style={styles.list}>
            {rules.slice(0, 8).map(rule => (
              <AlertRuleRow key={rule.id} rule={rule} />
            ))}
          </View>
        )}
        <EmptyState
          title="Native rule editing unavailable"
          message="This surface intentionally does not create, update, delete, snooze, or test rules until native validation and confirmation gates are implemented."
        />
      </ScreenSection>

      <ScreenSection
        title="Notification studio"
        subtitle="Write-oriented notification routes are represented as disabled native actions until validation and confirmation flows exist."
      >
        <View style={styles.metricGrid}>
          <KeyValueRow label="Create rules" value="Unavailable" />
          <KeyValueRow label="Edit rules" value="Unavailable" />
          <KeyValueRow label="Snooze rules" value="Unavailable" />
          <KeyValueRow label="Test channel sends" value="Unavailable" />
        </View>
        <EmptyState
          title="Native notification studio unavailable"
          message="Native write actions remain disabled instead of faking alert-studio or notification-studio parity without form validation, sudo confirmation, and test-send gates."
        />
      </ScreenSection>

      <RouteReadinessPanel
        title="Notification route readiness"
        subtitle="R0005 notification and alert redirects are represented by API-backed native summaries with unsafe write actions unavailable."
        items={notificationRouteItems}
        testID="notification-route-readiness"
      />

      <ScreenSection
        title="Delivery channels"
        subtitle="Configured notification transports from /notifications with secrets hidden and test sends disabled."
      >
        {channelsQuery.error ? (
          <EmptyState
            title="Notification channels unavailable"
            message="The channel endpoint could not be loaded; native push and channel tests are not treated as successful."
          />
        ) : channels.length === 0 ? (
          <EmptyState
            title={
              channelsQuery.isLoading
                ? 'Loading channels'
                : 'No delivery channels returned'
            }
            message="Discord, Slack, Telegram, email, webhook, ntfy, and Pushover channels will appear here after setup."
          />
        ) : (
          <View style={styles.list}>
            {channels.map(channel => (
              <ChannelRow key={channel.id} channel={channel} />
            ))}
          </View>
        )}
      </ScreenSection>

      <ScreenSection
        title="Notification audit trail"
        subtitle="Recent notification delivery rows are reused as an audit-style trail with status, channel, read, archive, and error context."
      >
        {auditQuery.error ? (
          <EmptyState
            title="Notification audit unavailable"
            message="The notification log endpoint could not be loaded for audit context."
          />
        ) : auditRows.length === 0 ? (
          <EmptyState
            title={
              auditQuery.isLoading
                ? 'Loading notification audit'
                : 'No notification audit rows returned'
            }
            message="Recent notification activity will appear here when delivery rows are present."
          />
        ) : (
          <View style={styles.list}>
            {auditRows.map(log => (
              <NotificationLogRow key={log.id} log={log} />
            ))}
          </View>
        )}
      </ScreenSection>

      <ScreenSection
        title="Quiet hours"
        subtitle="Do-not-disturb windows from /notifications/quiet-hours with bypass severity visibility."
      >
        {quietHoursQuery.error ? (
          <EmptyState
            title="Quiet-hours windows unavailable"
            message="The quiet-hours endpoint could not be loaded, so native delivery suppression status is unknown."
          />
        ) : quietHours.length === 0 ? (
          <EmptyState
            title={
              quietHoursQuery.isLoading
                ? 'Loading quiet hours'
                : 'No quiet-hours windows returned'
            }
            message="Configured do-not-disturb windows will appear here."
          />
        ) : (
          <View style={styles.list}>
            {quietHours.map(window => (
              <QuietHoursRow key={window.id} window={window} />
            ))}
          </View>
        )}
      </ScreenSection>

      <ScreenSection
        title="Alert escalation feed"
        subtitle="Legacy /alerts compatibility surface remains visible for active alert severity and read state."
      >
        {alertsQuery.error ? (
          <EmptyState
            title="Alerts unavailable"
            message="The active alerts endpoint could not be loaded from the TeslaSync API."
          />
        ) : alerts.length === 0 ? (
          <EmptyState
            title={
              alertsQuery.isLoading ? 'Loading alerts' : 'No alerts returned'
            }
            message="Unread alerts, escalation details, and active incidents will appear here."
          />
        ) : (
          <View style={styles.list}>
            {alerts.map(alert => (
              <ListRow
                key={alert.id}
                title={alert.title || `Alert ${alert.id}`}
                subtitle={alert.message || 'No alert message provided.'}
                meta={formatDateTime(alert.created_at)}
                icon={alert.is_read ? 'notifications' : 'notificationsActive'}
                detail={
                  <View style={styles.rowDetail}>
                    <StatusPill
                      label={alert.severity || 'info'}
                      state={statusState(alert.severity)}
                    />
                    <KeyValueRow
                      label="Read"
                      value={formatBoolean(alert.is_read)}
                    />
                  </View>
                }
              />
            ))}
          </View>
        )}
      </ScreenSection>

      <ScreenSection
        title="Native push readiness"
        subtitle="Platform push registration is explicit about unavailable states; this slice does not persist device tokens."
      >
        <View style={styles.metricGrid}>
          <KeyValueRow label="APNs registration" value="Unavailable" />
          <KeyValueRow label="FCM registration" value="Unavailable" />
          <KeyValueRow label="WNS registration" value="Unavailable" />
          <KeyValueRow label="Device token storage" value="Disabled" />
        </View>
        <EmptyState
          title="Push token registration unavailable"
          message="APNs, FCM, and WNS registration need native modules plus secure server enrollment. In-app notification data above is API-backed; OS push delivery is not claimed as working."
        />
      </ScreenSection>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  summaryPanel: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  metricGrid: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  rowDetail: {
    gap: spacing.xs,
  },
});
