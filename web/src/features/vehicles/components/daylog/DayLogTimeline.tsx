import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TFunction } from 'i18next';
import { Badge, Button, Code, GlassPanel, Input, PanelTitle, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import { useUnits } from '@/hooks/useUnits';
import type { DayLogEvent } from '@/api/types';
import {
  DAY_LOG_CATEGORIES,
  DAY_LOG_EVENT_TITLE,
  categoryOf,
  eventAccent,
  eventHref,
  eventIcon,
  eventKeywords,
  formatTimeSeconds,
  hourKeyInTz,
  payloadNumber,
  payloadString,
  type DayLogCategory,
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

type Row = { kind: 'hour'; key: string; hour: string } | { kind: 'event'; key: string; event: DayLogEvent };

/**
 * Section 3 — the complete-history list. Every recorded event renders
 * as an individual compact row (time with seconds, category, exact
 * component, previous → new state), virtualized so large days scroll
 * efficiently without dropping data. Search + category chips filter
 * client-side over the already-complete dataset; "Show all" and the
 * Showing X-of-Y indicator make filtered subsets explicit.
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
  const { formatDistance, formatEnergy } = useUnits();
  const [search, setSearch] = useState('');
  const [hidden, setHidden] = useState<ReadonlySet<DayLogCategory>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const parentRef = useRef<HTMLDivElement | null>(null);

  const all = events ?? [];
  const counts = useMemo(() => {
    const m = new Map<DayLogCategory, number>();
    for (const e of all) m.set(categoryOf(e.type), (m.get(categoryOf(e.type)) ?? 0) + 1);
    return m;
  }, [all]);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (query === '' && hidden.size === 0) return all;
    return all.filter((e) => {
      if (hidden.has(categoryOf(e.type))) return false;
      if (query === '') return true;
      const title = t(`dayLog.events.${e.type}`, e.type).toLowerCase();
      return title.includes(query) || eventKeywords(e).includes(query);
    });
  }, [all, hidden, query, t]);
  const isFiltered = query !== '' || hidden.size > 0;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastHour = '';
    for (const e of filtered) {
      const hour = hourKeyInTz(e.ts, timezone);
      if (hour !== '' && hour !== lastHour) {
        lastHour = hour;
        out.push({ kind: 'hour', key: `hour-${hour}-${out.length}`, hour });
      }
      out.push({ kind: 'event', key: e.id, event: e });
    }
    return out;
  }, [filtered, timezone]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 12,
  });

  const toggleCategory = (c: DayLogCategory) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };
  const showAll = () => {
    setSearch('');
    setHidden(new Set());
  };
  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const SearchIcon = Icons.search;
  const WarningIcon = Icons.warning;

  return (
    <GlassPanel className="p-6" data-testid="daylog-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <PanelTitle>{t('dayLog.timeline.title', 'Timeline')}</PanelTitle>
        {!isLoading && !error && (
          <Text variant="caption" data-testid="daylog-count">
            {isFiltered
              ? t('dayLog.timeline.showing', 'Showing {{shown}} of {{total}} events', {
                  shown: filtered.length,
                  total: all.length,
                })
              : t('dayLog.timeline.count', '{{count}} events', { count: all.length })}
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
        ) : all.length === 0 ? (
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
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-52 flex-1">
                <Input
                  aria-label={t('dayLog.list.searchLabel', 'Search events')}
                  placeholder={t('dayLog.list.searchPlaceholder', 'Search time, category, component, state…')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  icon={<SearchIcon className="h-4 w-4" />}
                  data-testid="daylog-search"
                />
              </div>
              <Button variant="secondary" onClick={showAll} disabled={!isFiltered} data-testid="daylog-show-all">
                {t('dayLog.list.showAll', 'Show all')}
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t('dayLog.list.filterLabel', 'Filter by category')}>
              {DAY_LOG_CATEGORIES.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => {
                const off = hidden.has(c);
                return (
                  <Button
                    key={c}
                    size="sm"
                    variant={off ? 'ghost' : 'secondary'}
                    aria-pressed={!off}
                    onClick={() => toggleCategory(c)}
                    data-testid={`daylog-filter-${c}`}
                  >
                    {t(`dayLog.categories.${c}`, c)} ({counts.get(c) ?? 0})
                  </Button>
                );
              })}
            </div>

            {truncated && (
              <div className="mt-3 flex items-start gap-2">
                <WarningIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <Text variant="caption">
                  {t(
                    'dayLog.timeline.truncated',
                    'Some records may be missing — the day exceeded the signal read cap. What loaded is shown in full.',
                  )}
                </Text>
              </div>
            )}

            <div className="mt-3">
              {filtered.length === 0 ? (
                <EmptyState
                  icon={<SearchIcon className="h-8 w-8" />}
                  message={t('dayLog.list.noMatch', 'No events match these filters.')}
                  description={t('dayLog.list.noMatchHint', 'The complete day is still loaded — widen the search or re-enable categories.')}
                  action={{ label: t('dayLog.list.showAll', 'Show all'), onClick: showAll }}
                />
              ) : (
                <div ref={parentRef} data-testid="daylog-list" role="list" className="h-[55vh] min-h-80 overflow-auto pr-1">
                  <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                    {virtualizer.getVirtualItems().map((vi) => {
                      const row = rows[vi.index];
                      return (
                        <div
                          key={row.key}
                          data-index={vi.index}
                          ref={virtualizer.measureElement}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${vi.start}px)`,
                          }}
                        >
                          {row.kind === 'hour' ? (
                            <HourSeparator hour={row.hour} />
                          ) : (
                            <EventRow
                              event={row.event}
                              timezone={timezone}
                              expanded={expanded.has(row.event.id)}
                              onToggle={() => toggleExpanded(row.event.id)}
                              t={t}
                              formatDistance={formatDistance}
                              formatEnergy={formatEnergy}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </GlassPanel>
  );
}

function HourSeparator({ hour }: { hour: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5" aria-hidden="true">
      <div className="h-px flex-1 bg-white/[0.08]" />
      <Text variant="caption" className="tabular-nums">
        {hour}:00
      </Text>
      <div className="h-px flex-1 bg-white/[0.08]" />
    </div>
  );
}

interface EventRowProps {
  event: DayLogEvent;
  timezone: string;
  expanded: boolean;
  onToggle: () => void;
  t: TFunction;
  formatDistance: (v: number | null | undefined) => string;
  formatEnergy: (v: number | null | undefined) => string;
}

function EventRow({ event, timezone, expanded, onToggle, t, formatDistance, formatEnergy }: EventRowProps) {
  const Icon = eventIcon(event.type);
  const href = eventHref(event);
  const { title, detail } = describeEvent(t, event, { formatDistance, formatEnergy });
  const ExpandIcon = expanded ? Icons.collapse : Icons.expand;

  return (
    <div role="listitem" className="border-b border-white/[0.05] py-1.5" data-testid={`daylog-event-${event.id}`}>
      <div className="flex items-center gap-2.5">
        <Text variant="caption" className="w-16 shrink-0 tabular-nums">
          {formatTimeSeconds(event.ts, timezone)}
        </Text>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${eventAccent(event.type)}22`, color: eventAccent(event.type) }}
          aria-hidden="true"
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <Text as="div" size="sm" weight="medium" className="truncate">
            {href ? (
              <Link to={href} className="text-sky-300 underline-offset-2 hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </Text>
          {detail != null && (
            <Text variant="caption" className="truncate">
              {detail}
            </Text>
          )}
        </div>
        <Badge variant="neutral" size="sm" className="hidden shrink-0 sm:inline-flex">
          {t(`dayLog.categories.${categoryOf(event.type)}`, categoryOf(event.type))}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t('dayLog.list.collapse', 'Hide details')
              : t('dayLog.list.expand', 'Show details')
          }
        >
          <ExpandIcon className="h-4 w-4" />
        </Button>
      </div>
      {expanded && (
        <div className="ml-[4.75rem] mt-1.5 space-y-1 rounded-md bg-white/[0.03] p-3">
          <DetailLine label={t('dayLog.list.detailCategory', 'Category')} value={t(`dayLog.categories.${categoryOf(event.type)}`, categoryOf(event.type))} />
          <DetailLine label={t('dayLog.list.detailSource', 'Source')} value={event.source} mono />
          <DetailLine label={t('dayLog.list.detailId', 'Event')} value={event.id} mono />
          <DetailLine label={t('dayLog.list.detailLayer', 'Layer')} value={event.layer} mono />
          <DetailLine label={t('dayLog.list.detailTime', 'Timestamp')} value={event.ts} mono />
          <div>
            <Text variant="caption" className="font-medium">
              {t('dayLog.list.detailPayload', 'Recorded details')}
            </Text>
            <Code className="mt-1 block max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(event.payload ?? {}, null, 2)}
            </Code>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <Text variant="caption" className="font-medium">
        {label}:
      </Text>
      {mono ? (
        <Code className="break-all text-xs">{value}</Code>
      ) : (
        <Text variant="caption">{value}</Text>
      )}
    </div>
  );
}

type Formatters = {
  formatDistance: (v: number | null | undefined) => string;
  formatEnergy: (v: number | null | undefined) => string;
};

/**
 * Title + one-line detail per event. from/to states render through
 * label maps with raw fallbacks: unknown tokens show verbatim, never
 * guessed, and absent states collapse to null (no subtitle).
 */
function describeEvent(t: TFunction, event: DayLogEvent, fmt: Formatters): { title: string; detail: string | null } {
  const p = event.payload ?? {};
  const title = (fallback?: string) =>
    t(`dayLog.events.${event.type}`, fallback ?? DAY_LOG_EVENT_TITLE[event.type] ?? event.type);
  const fromTo = (render: (v: unknown) => string | null): string | null => {
    const from = 'from' in p ? render(p.from) : null;
    const to = 'to' in p ? render(p.to) : null;
    if (from != null && to != null) return `${from} → ${to}`;
    return to ?? from;
  };
  const raw = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return null;
  };
  const onOff = (v: unknown): string | null => {
    if (v === true) return t('dayLog.state.on', 'On');
    if (v === false) return t('dayLog.state.off', 'Off');
    return raw(v);
  };

  switch (event.type) {
    case 'turn_signal': {
      const component = payloadString(p, 'component');
      const label = (v: unknown) =>
        typeof v === 'string' ? t(`dayLog.turnSignal.${v}`, v) : raw(v);
      return {
        title:
          component != null
            ? t(`dayLog.turnSignalTitle.${component}`, title('Turn signal'))
            : title('Turn signal'),
        detail: fromTo(label),
      };
    }
    case 'door_open':
    case 'door_closed': {
      const door = payloadString(p, 'door');
      const name = door != null ? t(`dayLog.doors.${door}`, door) : null;
      const state = (v: unknown) => {
        if (v === true) return t('dayLog.state.open', 'Open');
        if (v === false) return t('dayLog.state.closed', 'Closed');
        return raw(v);
      };
      const transition = fromTo(state);
      return {
        title: title(event.type === 'door_open' ? 'Door opened' : 'Door closed'),
        detail: [name, transition].filter((s): s is string => s != null).join(' · ') || null,
      };
    }
    case 'window': {
      const window = payloadString(p, 'window');
      const name = window != null ? t(`dayLog.windows.${window}`, window) : null;
      const state = (v: unknown) =>
        typeof v === 'string' ? t(`dayLog.windowStates.${v}`, v) : raw(v);
      const transition = fromTo(state);
      return {
        title: title(),
        detail: [name, transition].filter((s): s is string => s != null).join(' · ') || null,
      };
    }
    case 'gear': {
      const state = (v: unknown) =>
        typeof v === 'string' ? t(`dayLog.gears.${v}`, v) : raw(v);
      return { title: title(), detail: fromTo(state) };
    }
    case 'hvac_on':
    case 'hvac_off': {
      const state = (v: unknown) =>
        typeof v === 'string' ? t(`dayLog.hvacStates.${v}`, v) : raw(v);
      return { title: title(event.type === 'hvac_on' ? 'HVAC on' : 'HVAC off'), detail: fromTo(state) };
    }
    case 'sentry_on':
    case 'sentry_off':
    case 'sentry_unknown': {
      const state = (v: unknown) =>
        typeof v === 'string' ? t(`dayLog.sentryStates.${v}`, v) : raw(v);
      return { title: title(), detail: fromTo(state) };
    }
    case 'locked':
    case 'unlocked':
    case 'lock_unknown': {
      const state = (v: unknown) => {
        if (v === true) return t('dayLog.lockState.locked', 'Locked');
        if (v === false) return t('dayLog.lockState.unlocked', 'Unlocked');
        return raw(v);
      };
      return { title: title(), detail: fromTo(state) };
    }
    case 'parked':
    case 'online':
    case 'asleep':
    case 'offline':
    case 'state_change': {
      const state = (v: unknown) =>
        typeof v === 'string' ? t(`dayLog.states.${v}`, v) : raw(v);
      return { title: title(), detail: fromTo(state) };
    }
    case 'remote_start_on':
    case 'remote_start_off':
    case 'hazards_on':
    case 'hazards_off':
    case 'high_beams_on':
    case 'high_beams_off':
    case 'homelink_nearby_on':
    case 'homelink_nearby_off':
    case 'valet_on':
    case 'valet_off':
    case 'valet_unknown':
      return { title: title(), detail: fromTo(onOff) };
    case 'arrived_home':
    case 'left_home':
    case 'arrived_work':
    case 'left_work':
    case 'arrived_favorite':
    case 'left_favorite':
      // Self-describing: the type already names place + direction.
      return { title: title(), detail: null };
    case 'drive_start':
      return { title: title(), detail: payloadString(p, 'start_place') };
    case 'drive_end': {
      const parts: string[] = [];
      const place = payloadString(p, 'end_place');
      if (place) parts.push(place);
      const dist = payloadNumber(p, 'distance_m');
      if (dist != null) parts.push(fmt.formatDistance(dist));
      return { title: title(), detail: parts.length > 0 ? parts.join(' · ') : null };
    }
    case 'charge_start':
      return { title: title(), detail: payloadString(p, 'start_place') };
    case 'charge_end': {
      const energy = payloadNumber(p, 'energy_added_wh');
      return { title: title(), detail: energy != null ? fmt.formatEnergy(energy) : null };
    }
    case 'sw_update': {
      const version = payloadString(p, 'version');
      const status = payloadString(p, 'status');
      if (version && status) return { title: title(), detail: `${version} · ${status}` };
      return { title: title(), detail: version ?? status };
    }
    case 'sw_update_installed':
      return { title: title(), detail: payloadString(p, 'version') };
    case 'security': {
      const typ = payloadString(p, 'event_type');
      const transition = fromTo(raw);
      return {
        title: title(),
        detail: [typ, transition].filter((s): s is string => s != null).join(' · ') || null,
      };
    }
    case 'signal': {
      const field = payloadString(p, 'field');
      const transition = fromTo(raw);
      return {
        title: title(),
        detail: [field, transition].filter((s): s is string => s != null).join(' · ') || null,
      };
    }
    default:
      // Future types render with their raw identity, never vanish.
      return { title: title(), detail: fromTo(raw) };
  }
}
