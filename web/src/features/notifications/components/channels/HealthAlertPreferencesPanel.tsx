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
import { GlassPanel, Heading, Select, Text } from '@/components/ui';
import { HealthAlertComponentRow, componentLabel } from './HealthAlertComponentRow';
import { HealthAlertFilters, type HealthFilter } from './HealthAlertFilters';

interface HealthAlertPreferencesPanelProps {
  channels: NotificationChannel[];
  onAddChannel: () => void;
}

interface EventGroup {
  component: string;
  entries: NotificationEventType[];
}

export function HealthAlertPreferencesPanel({
  channels,
  onAddChannel,
}: HealthAlertPreferencesPanelProps) {
  const { t } = useTranslation();
  const safeChannels = channels ?? [];
  const [requestedChannelId, setRequestedChannelId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<HealthFilter>('all');
  const selectedChannel = safeChannels.find((channel) => channel.id === requestedChannelId)
    ?? safeChannels[0];
  const selectedChannelId = selectedChannel?.id ?? null;

  const eventTypesQuery = useNotificationEventTypes();
  const preferencesQuery = useNotificationPreferences(selectedChannelId);
  const updatePreference = useUpdateNotificationPreference();
  const [pendingEvent, setPendingEvent] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
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
  const enabled = (entry: NotificationEventType) =>
    explicitByEvent.get(entry.event_type) ?? entry.default_enabled;
  const enabledCount = groups.reduce(
    (sum, group) => sum + group.entries.filter(enabled).length, 0,
  );
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const visible = groups.filter((group) => {
    const matchesSearch =
      componentLabel(group.component, t).toLowerCase().includes(search.trim().toLowerCase())
      || group.entries.some((entry) =>
        t(`notifications.healthAlerts.events.${entry.component}.${entry.transition}`, entry.description)
          .toLowerCase().includes(search.trim().toLowerCase()));
    const active = group.entries.filter(enabled).length;
    return matchesSearch
      && (filter === 'all'
        || (filter === 'enabled' && active > 0)
        || (filter === 'disabled' && active < group.entries.length));
  });

  const retry = () => {
    void eventTypesQuery.refetch();
    if (selectedChannelId !== null) void preferencesQuery.refetch();
  };
  const update = async (entry: NotificationEventType, value: boolean) => {
    if (selectedChannelId === null || pendingEvent !== null) return;
    setPendingEvent(entry.event_type);
    setSaveError(false);
    try {
      await updatePreference.mutateAsync({
        channel_id: selectedChannelId,
        event_type: entry.event_type,
        enabled: value,
      });
    } catch {
      setSaveError(true);
    } finally {
      setPendingEvent(null);
    }
  };

  return (
    <GlassPanel className="p-4 sm:p-6" role="region" aria-labelledby="health-alert-preferences-heading">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg bg-amber-400/10 p-2 text-amber-300 ring-1 ring-amber-300/20">
            <BellRing className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <Heading id="health-alert-preferences-heading" level="panel" as="h3">
              {t('notifications.healthAlerts.title', 'Component health alerts')}
            </Heading>
            <Text as="p" variant="bodySm" className="mt-1 max-w-2xl">
              {t('notifications.healthAlerts.subtitle',
                'Choose which system outages and recoveries are delivered to each channel. These are system events, separate from vehicle alert rules.')}
            </Text>
          </div>
        </div>
        {safeChannels.length > 0 && (
          <div className="w-full shrink-0 lg:w-72">
            <Select
              label={t('notifications.healthAlerts.channelLabel', 'Delivery channel')}
              value={String(selectedChannelId)}
              disabled={pendingEvent !== null}
              options={safeChannels.map((channel) => ({
                value: String(channel.id),
                label: channel.enabled
                  ? `${channel.name} (${channel.kind})`
                  : t('notifications.healthAlerts.disabledChannel', '{{name}} (disabled)', { name: channel.name }),
              }))}
              onChange={(event) => { setRequestedChannelId(Number(event.target.value)); setSaveError(false); }}
            />
          </div>
        )}
      </div>

      {safeChannels.length === 0 ? (
        <EmptyState
          icon={<BellRing className="h-8 w-8" />}
          title={t('notifications.healthAlerts.noChannelsTitle', 'Add a delivery channel first')}
          message={t('notifications.healthAlerts.noChannels',
            'Health alerts need a notification destination such as Discord, Slack, ntfy, or a webhook.')}
          action={{ label: t('notifications.healthAlerts.addChannel', 'Add notification channel'), onClick: onAddChannel }}
          className="py-8"
        />
      ) : eventTypesQuery.isError || preferencesQuery.isError ? (
        <QueryError error={eventTypesQuery.error ?? preferencesQuery.error} onRetry={retry} />
      ) : eventTypesQuery.isLoading || preferencesQuery.isLoading ? (
        <div className="mt-5 space-y-3" aria-label={t('common.loading', 'Loading')}>
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<BellRing className="h-8 w-8" />}
          message={t('notifications.healthAlerts.noEvents', 'No component health event types are available from this server.')}
          action={{ label: t('notifications.healthAlerts.refreshEvents', 'Refresh event types'), onClick: retry }}
          className="py-8"
        />
      ) : (
        <div className="mt-5 space-y-4">
          {!selectedChannel.enabled && (
            <Text as="p" variant="bodySm" role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              {t('notifications.healthAlerts.channelOff',
                'This channel is disabled. Your choices are saved, but no alerts will be delivered until you enable the channel above.')}
            </Text>
          )}
          <HealthAlertFilters enabledCount={enabledCount} total={total}
            channelEnabled={selectedChannel.enabled} search={search} onSearch={setSearch}
            filter={filter} onFilter={setFilter} />
          {saveError && (
            <Text as="p" variant="bodySm" role="alert" className="text-rose-400">
              {t('notifications.healthAlerts.saveError', 'Could not save this choice. Check your connection and try again.')}
            </Text>
          )}
          {visible.length === 0 ? (
            <EmptyState
              message={t('notifications.healthAlerts.noMatches', 'No components match your search or filter.')}
              action={{ label: t('common.clearFilters', 'Clear filters'), onClick: () => { setSearch(''); setFilter('all'); } }}
            />
          ) : (
            <div className="space-y-2">
              {visible.map((group) => (
                <HealthAlertComponentRow key={group.component} group={group}
                  enabled={enabled} onChange={update} busy={pendingEvent !== null}
                  pendingEvent={pendingEvent} />
              ))}
            </div>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
