import { useTranslation } from 'react-i18next';
import { Badge, Heading, Text, Toggle } from '@/components/ui';
import type { NotificationEventType } from '@/api/types';

interface Props {
  group: { component: string; entries: NotificationEventType[] };
  enabled: (entry: NotificationEventType) => boolean;
  onChange: (entry: NotificationEventType, enabled: boolean) => void;
  busy: boolean;
  pendingEvent: string | null;
}

export function componentLabel(component: string, t: ReturnType<typeof useTranslation>['t']): string {
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

export function HealthAlertComponentRow({ group, enabled, onChange, busy, pendingEvent }: Props) {
  const { t } = useTranslation();
  const label = componentLabel(group.component, t);
  const active = group.entries.filter(enabled).length;
  const state = active === 0
    ? t('notifications.healthAlerts.off', 'Off')
    : active === group.entries.length
      ? t('notifications.healthAlerts.bothOn', 'Outage + recovery')
      : t('notifications.healthAlerts.partial', '{{count}} of {{total}} on', {
        count: active, total: group.entries.length,
      });

  return (
    <section aria-label={label}
      className="grid gap-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4 xl:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
      <div className="min-w-0">
        <Heading level="sub" as="h5">{label}</Heading>
        <Badge variant={active === 0 ? 'neutral' : 'success'} size="sm" className="mt-2">{state}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {group.entries.map((entry) => {
          const transitionLabel = entry.transition === 'outage'
            ? t('notifications.healthAlerts.outage', '{{component}} outage', { component: label })
            : t('notifications.healthAlerts.recovery', '{{component}} recovery', { component: label });
          const descriptionId = `health-event-${entry.event_type.replace(/[^a-zA-Z0-9-]/g, '-')}`;
          return (
            <div key={entry.event_type}
              className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="min-w-0">
                <Text as="p" variant="bodySm">{transitionLabel}</Text>
                <Text as="p" id={descriptionId} variant="caption" className="mt-1">
                  {t(`notifications.healthAlerts.events.${entry.component}.${entry.transition}`, entry.description)}
                </Text>
                {pendingEvent === entry.event_type && (
                  <Text as="p" variant="caption" role="status">
                    {t('notifications.healthAlerts.saving', 'Saving…')}
                  </Text>
                )}
              </div>
              <Toggle size="md" checked={enabled(entry)} disabled={busy}
                aria-label={transitionLabel} aria-describedby={descriptionId}
                onChange={(next) => onChange(entry, next)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
