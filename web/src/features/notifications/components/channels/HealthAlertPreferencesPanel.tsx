import { useMemo, useState } from 'react';
import { BellRing } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  useNotificationEventTypes,
  useNotificationPreferences,
  useUpdateNotificationPreference,
  type NotificationEventType,
} from '@/api/hooks/useNotifications';
import type { NotificationChannel } from '@/api/types';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { GlassPanel, Heading, Select, Text, Toggle } from '@/components/ui';

interface HealthAlertPreferencesPanelProps {
  channels: NotificationChannel[];
  onAddChannel: () => void;
}

interface EventGroup {
  component: string;
  entries: NotificationEventType[];
}

function componentLabel(component: string, t: ReturnType<typeof useTranslation>['t']): string {
  const fallbacks: Record<string, string> = {
    telemetry: 'Fleet Telemetry',
    mqtt: 'MQTT',
    database: 'Database',
    redis: 'Redis',
    tesla_api: 'Tesla API authorization',
    worker: 'Background worker',
  };
  return t(
    `notifications.healthAlerts.components.${component}`,
    fallbacks[component] ?? component.replace(/_/g, ' '),
  );
}

export function HealthAlertPreferencesPanel({
  channels,
  onAddChannel,
}: HealthAlertPreferencesPanelProps) {
  const { t } = useTranslation();
  const safeChannels = channels ?? [];
  const [requestedChannelId, setRequestedChannelId] = useState<number | null>(null);
  const selectedChannelId =
    safeChannels.some((channel) => channel.id === requestedChannelId)
      ? requestedChannelId
      : safeChannels[0]?.id ?? null;

  const eventTypesQuery = useNotificationEventTypes();
  const preferencesQuery = useNotificationPreferences(selectedChannelId);
  const updatePreference = useUpdateNotificationPreference();
  const preferences = preferencesQuery.data ?? [];
  const explicitByEvent = useMemo(
    () => new Map(preferences.map((preference) => [preference.event_type, preference.enabled])),
    [preferences],
  );
  const groups = useMemo<EventGroup[]>(() => {
    const byComponent = new Map<string, NotificationEventType[]>();
    for (const entry of eventTypesQuery.data ?? []) {
      const entries = byComponent.get(entry.component) ?? [];
      entries.push(entry);
      byComponent.set(entry.component, entries);
    }
    return Array.from(byComponent, ([component, entries]) => ({ component, entries }));
  }, [eventTypesQuery.data]);

  const channelOptions = safeChannels.map((channel) => ({
    value: String(channel.id),
    label: channel.enabled
      ? `${channel.name} (${channel.kind})`
      : t(
          'notifications.healthAlerts.disabledChannel',
          '{{name}} (disabled)',
          { name: channel.name },
        ),
  }));

  const retry = () => {
    void eventTypesQuery.refetch();
    if (selectedChannelId !== null) {
      void preferencesQuery.refetch();
    }
  };

  return (
    <GlassPanel
      className="p-4 sm:p-5"
      role="region"
      aria-labelledby="health-alert-preferences-heading"
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-amber-400/10 p-2 text-amber-300 ring-1 ring-amber-300/20">
            <BellRing className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <Heading id="health-alert-preferences-heading" level="panel" as="h3">
              {t('notifications.healthAlerts.title', 'Component health alerts')}
            </Heading>
            <Text as="p" variant="caption" className="mt-1 max-w-3xl">
              {t(
                'notifications.healthAlerts.subtitle',
                'Choose which outage and recovery events TeslaSync sends through each notification channel.',
              )}
            </Text>
          </div>
        </div>
        {safeChannels.length > 0 && (
          <div className="w-full shrink-0 sm:w-72">
            <Select
              label={t('notifications.healthAlerts.channelLabel', 'Delivery channel')}
              value={selectedChannelId === null ? '' : String(selectedChannelId)}
              options={channelOptions}
              onChange={(event) => setRequestedChannelId(Number(event.target.value))}
            />
          </div>
        )}
      </div>

      {safeChannels.length === 0 ? (
        <EmptyState
          icon={<BellRing className="h-8 w-8" />}
          title={t('notifications.healthAlerts.noChannelsTitle', 'Add a delivery channel first')}
          message={t(
            'notifications.healthAlerts.noChannels',
            'Health alerts need an enabled notification destination such as Discord, Slack, ntfy, or a webhook.',
          )}
          action={{
            label: t('notifications.healthAlerts.addChannel', 'Add notification channel'),
            onClick: onAddChannel,
          }}
          className="py-8"
        />
      ) : eventTypesQuery.isError || preferencesQuery.isError ? (
        <QueryError
          error={eventTypesQuery.error ?? preferencesQuery.error}
          onRetry={retry}
        />
      ) : eventTypesQuery.isLoading || preferencesQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={t('common.loading', 'Loading')}>
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<BellRing className="h-8 w-8" />}
          message={t(
            'notifications.healthAlerts.noEvents',
            'No component health event types are available from this server.',
          )}
          action={{
            label: t('notifications.healthAlerts.refreshEvents', 'Refresh event types'),
            onClick: retry,
          }}
          className="py-8"
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const label = componentLabel(group.component, t);
            return (
              <section
                key={group.component}
                aria-label={label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4"
              >
                <Heading level="sub" as="h4">{label}</Heading>
                <div className="mt-3 space-y-3">
                  {group.entries.map((entry) => {
                    const checked =
                      explicitByEvent.get(entry.event_type) ?? entry.default_enabled;
                    const descriptionId = `health-event-${entry.event_type.replace(/\./g, '-')}`;
                    const transitionLabel =
                      entry.transition === 'outage'
                        ? t('notifications.healthAlerts.outage', '{{component}} outage', {
                            component: label,
                          })
                        : t('notifications.healthAlerts.recovery', '{{component}} recovery', {
                            component: label,
                          });
                    return (
                      <div
                        key={entry.event_type}
                        className="flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <Text as="p" variant="bodySm">{transitionLabel}</Text>
                          <Text id={descriptionId} as="p" variant="caption" className="mt-0.5">
                            {t(
                              `notifications.healthAlerts.events.${entry.component}.${entry.transition}`,
                              entry.description,
                            )}
                          </Text>
                        </div>
                        <Toggle
                          size="sm"
                          checked={checked}
                          aria-label={transitionLabel}
                          aria-describedby={descriptionId}
                          onChange={(enabled) => {
                            if (selectedChannelId === null) return;
                            updatePreference.mutate({
                              channel_id: selectedChannelId,
                              event_type: entry.event_type,
                              enabled,
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
