import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import {
  Lock,
  Unlock,
  ShieldCheck,
  ShieldAlert,
  DoorClosed,
  DoorOpen,
} from 'lucide-react';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import type { TimelineEvent } from './helpers';

/* ------------------------------------------------------------------ */
/*  Icon + tone resolution based on semantic timeline data              */
/* ------------------------------------------------------------------ */

const variantChip: Record<TimelineEvent['variant'], string> = {
  positive: 'bg-neon-green/10 text-emerald-300',
  negative: 'bg-neon-red/10 text-rose-300',
  neutral: 'bg-white/[0.04] text-[var(--text-muted)]',
};

function timelineIcon(ev: TimelineEvent) {
  switch (ev.kind) {
    case 'lock':
      return ev.variant === 'positive'
        ? <Lock className="h-4 w-4" />
        : <Unlock className="h-4 w-4" />;
    case 'sentry':
      return ev.variant === 'positive'
        ? <ShieldCheck className="h-4 w-4" />
        : <ShieldAlert className="h-4 w-4" />;
    case 'door':
      return ev.variant === 'positive'
        ? <DoorClosed className="h-4 w-4" />
        : <DoorOpen className="h-4 w-4" />;
    default:
      // Defensive: an unrecognised kind (e.g. a future backend enum) renders
      // no glyph rather than an empty broken chip.
      return null;
  }
}

function useTimelineLabels() {
  const { t } = useTranslation();
  return (ev: TimelineEvent): { title: string; subtitle: string } => {
    switch (ev.kind) {
      case 'lock':
        return {
          title: ev.variant === 'positive'
            ? t('admin.security.timeline.lock.positive', 'Vehicle Locked')
            : t('admin.security.timeline.lock.negative', 'Vehicle Unlocked'),
          subtitle: ev.variant === 'positive'
            ? t('admin.security.timeline.lock.positiveDesc', 'Doors secured')
            : t('admin.security.timeline.lock.negativeDesc', 'Doors accessible'),
        };
      case 'sentry':
        return {
          title: ev.variant === 'positive'
            ? t('admin.security.timeline.sentry.positive', 'Sentry Mode Activated')
            : t('admin.security.timeline.sentry.negative', 'Sentry Mode Deactivated'),
          subtitle: ev.variant === 'positive'
            ? t('admin.security.timeline.sentry.positiveDesc', 'Camera surveillance enabled')
            : t('admin.security.timeline.sentry.negativeDesc', 'Camera surveillance disabled'),
        };
      case 'door':
        return {
          title: ev.variant === 'positive'
            ? t('admin.security.timeline.door.positive', 'Doors Closed')
            : t('admin.security.timeline.door.negative', 'Door Opened'),
          subtitle: ev.detail || (ev.variant === 'positive'
            ? t('admin.security.closed', 'Closed')
            : t('admin.security.open', 'Open')),
        };
      default:
        // Defensive: a malformed row whose `kind` falls outside the known
        // union must degrade to a neutral label instead of returning
        // `undefined` and crashing the whole panel when the caller
        // destructures `{ title, subtitle }`.
        return {
          title: t('admin.security.timeline.unknown', 'State Change'),
          subtitle: t('admin.security.timeline.unknownDesc', 'Vehicle state updated'),
        };
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface EventTimelineProps {
  timelineEvents: TimelineEvent[];
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export function EventTimeline({ timelineEvents, isLoading, error, onRetry, className }: EventTimelineProps) {
  const { t } = useTranslation();
  const getLabels = useTimelineLabels();
  const events = timelineEvents ?? [];

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3">{t('admin.security.timeline.title', 'Security Event Timeline')}</PanelTitle>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton lines={8} />
      ) : events.length > 0 ? (
        <ul className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {events.map((ev) => {
            const { title, subtitle } = getLabels(ev);
            return (
              <li key={ev.id} className="flex items-start gap-3 rounded-lg bg-white/[0.02] p-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    variantChip[ev.variant],
                  )}
                >
                  {timelineIcon(ev)}
                </span>
                <div className="min-w-0 flex-1">
                  <Text as="p" size="sm" weight="medium" color="primary" className="truncate">
                    {title}
                  </Text>
                  <Text as="p" variant="caption" className="truncate">
                    {subtitle}
                  </Text>
                </div>
                <TimeStamp
                  value={ev.timestamp}
                  className={cn('shrink-0 whitespace-nowrap', typography.size['2xs'], 'text-[var(--text-muted)]')}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          message={t('admin.security.timeline.noEvents', 'No state changes detected in the history.')}
          action={onRetry ? { label: t('common.retry', 'Retry'), onClick: onRetry } : undefined}
        />
      )}
    </GlassPanel>
  );
}
