import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { Timeline, type TimelineItemData } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { formatTime } from '@/lib/dateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { DayLogEvent } from '@/api/types';
import {
  DAY_LOG_EVENT_TITLE,
  eventAccent,
  eventHref,
  eventIcon,
  payloadNumber,
  payloadString,
} from '../../lib/daylog';

export interface DayLogTimelineProps {
  events: DayLogEvent[] | null;
  timezone: string;
  vehicleId: number | null;
  truncated: boolean;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Section 3 — the hero timeline. Titles localise by event type; SI
 * payload measures render through `useUnits()`; drive/charge events
 * deep-link to their detail routes. Times render in the queried
 * timezone so they always agree with the day boundaries.
 */
export function DayLogTimeline({
  events,
  timezone,
  vehicleId,
  truncated,
  isLoading,
  error,
  onRetry,
}: DayLogTimelineProps) {
  const { t } = useTranslation();
  const { formatDistance, formatDuration, formatEnergy, formatPower } = useUnits();

  const items = useMemo<TimelineItemData[]>(
    () =>
      (events ?? []).map((event) => {
        const Icon = eventIcon(event.type);
        const title = t(`dayLog.events.${event.type}`, DAY_LOG_EVENT_TITLE[event.type] ?? event.type);
        const href = eventHref(event);
        return {
          icon: <Icon className="h-3.5 w-3.5" />,
          title: href ? (
            <Link to={href} className="text-sky-300 underline-offset-2 hover:underline">
              {title}
            </Link>
          ) : (
            title
          ),
          subtitle: describeEvent(t, event, { formatDistance, formatDuration, formatEnergy, formatPower }),
          time: formatTime(event.ts, { tz: timezone }),
          color: eventAccent(event.type),
        };
      }),
    [events, formatDistance, formatDuration, formatEnergy, formatPower, t, timezone],
  );

  return (
    <GlassPanel className="p-6" data-testid="daylog-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <PanelTitle>{t('dayLog.timeline.title', 'Timeline')}</PanelTitle>
        {!isLoading && !error && (events ?? []).length > 0 && (
          <Text variant="caption">
            {t('dayLog.timeline.count', '{{count}} events', { count: (events ?? []).length })}
          </Text>
        )}
      </div>
      <div className="mt-4">
        {isLoading ? (
          <div role="status" aria-label={t('dayLog.timeline.loading', 'Loading timeline')}>
            <Skeleton lines={8} />
          </div>
        ) : error ? (
          <QueryError error={error} onRetry={onRetry} resourceName={t('dayLog.timeline.title', 'Timeline')} />
        ) : (events ?? []).length === 0 ? (
          <EmptyState
            icon={<Icons.moon className="h-8 w-8" />}
            message={t('dayLog.timeline.empty', 'Nothing recorded this day.')}
            description={t(
              'dayLog.timeline.emptyHint',
              'The car was quiet — or telemetry never arrived. Live signals show what the car reports right now.',
            )}
            actionTo={{
              label: t('dayLog.timeline.liveCta', 'Open live telemetry'),
              to: vehicleId != null ? `/live-monitor?vehicle_id=${vehicleId}` : '/live-monitor',
            }}
          />
        ) : (
          <>
            {truncated && (
              <Text variant="caption" className="mb-3">
                {t(
                  'dayLog.timeline.truncated',
                  'Showing the first 500 events — narrow the day or disable layers to see more.',
                )}
              </Text>
            )}
            <Timeline
              items={items}
              label={t('dayLog.timeline.title', 'Timeline')}
              emptyMessage={t('dayLog.timeline.empty', 'Nothing recorded this day.')}
            />
          </>
        )}
      </div>
    </GlassPanel>
  );
}

type Formatters = {
  formatDistance: (v: number | null | undefined) => string;
  formatDuration: (v: number | null | undefined) => string;
  formatEnergy: (v: number | null | undefined) => string;
  formatPower: (v: number | null | undefined) => string;
};

/**
 * One-line human detail per event from its SI payload. Unknown or
 * absent payload values degrade to null (no subtitle) rather than a
 * guessed string.
 */
function describeEvent(t: TFunction, event: DayLogEvent, fmt: Formatters): string | null {
  const p = event.payload ?? {};
  switch (event.type) {
    case 'drive_start':
      return payloadString(p, 'start_place');
    case 'drive_end': {
      const parts: string[] = [];
      const place = payloadString(p, 'end_place');
      if (place) parts.push(place);
      const dist = payloadNumber(p, 'distance_m');
      if (dist != null) parts.push(fmt.formatDistance(dist));
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    case 'charge_start':
      return payloadString(p, 'start_place');
    case 'charge_end': {
      const energy = payloadNumber(p, 'energy_added_wh');
      return energy != null ? fmt.formatEnergy(energy) : null;
    }
    case 'parked':
    case 'online':
    case 'asleep':
    case 'offline': {
      const from = payloadString(p, 'from_state');
      return from ? t('dayLog.details.fromState', 'from {{state}}', { state: stateLabel(t, from) }) : null;
    }
    case 'state_change': {
      const to = payloadString(p, 'to_state');
      return to ? stateLabel(t, to) : null;
    }
    case 'sentry_on':
    case 'sentry_off':
      return sentryLabel(t, payloadString(p, 'state'));
    case 'lock_unknown':
    case 'sentry_unknown':
      return payloadString(p, 'state');
    case 'sw_update': {
      const version = payloadString(p, 'version');
      const status = payloadString(p, 'status');
      if (version && status) return `${version} · ${status}`;
      return version ?? status;
    }
    case 'sw_update_installed':
      return payloadString(p, 'version');
    case 'turn_signal': {
      const v = payloadNumber(p, 'value');
      return v != null ? t('dayLog.details.signalValue', 'signal {{value}}', { value: v }) : null;
    }
    case 'door_open':
    case 'door_closed': {
      const door = payloadString(p, 'door');
      return door ? t(`dayLog.doors.${door}`, door) : null;
    }
    case 'window': {
      const window = payloadString(p, 'window');
      return window ? t(`dayLog.windows.${window}`, window) : null;
    }
    case 'hvac_on': {
      const w = payloadNumber(p, 'power_w');
      return w != null ? fmt.formatPower(w) : null;
    }
    case 'gear':
      return payloadString(p, 'gear');
    default:
      return null;
  }
}

function stateLabel(t: TFunction, state: string): string {
  return t(`dayLog.states.${state}`, state);
}

function sentryLabel(t: TFunction, state: string | null): string | null {
  if (!state) return null;
  if (state === 'SentryModeStateOff' || state === 'SentryModeStateUnknown') {
    return t('dayLog.details.sentryOff', 'disarmed');
  }
  return t('dayLog.details.sentryOn', 'armed ({{state}})', { state });
}
