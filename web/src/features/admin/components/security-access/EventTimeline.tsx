import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import {
  Lock,
  Unlock,
  ShieldCheck,
  ShieldAlert,
  DoorClosed,
  DoorOpen,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { TimeStamp } from '@/components/data-display';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import type { TimelineEvent } from './helpers';

/* ------------------------------------------------------------------ */
/*  Icon + text resolution based on semantic timeline data              */
/* ------------------------------------------------------------------ */

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
          subtitle: ev.detail,
        };
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface EventTimelineProps {
  timelineEvents: TimelineEvent[];
}

export function EventTimeline({ timelineEvents }: EventTimelineProps) {
  const { t } = useTranslation();
  const getLabels = useTimelineLabels();

  return (
    <FadeIn delay={0.35}>
      <GlassPanel className="p-4">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">
          {t('admin.security.timeline.title', 'Security Event Timeline')}
        </h2>
        {timelineEvents.length > 0 ? (
          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {timelineEvents.map((ev) => {
              const { title, subtitle } = getLabels(ev);
              return (
                <div
                  key={ev.id}
                  className="flex items-start gap-3 rounded-lg bg-white/[0.02] p-3"
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      ev.variant === 'positive'
                        ? 'bg-green-500/20 text-green-400'
                        : ev.variant === 'negative'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-500/20 text-[var(--text-muted)]',
                    )}
                  >
                    {timelineIcon(ev)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200">{title}</p>
                    <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
                  </div>
                  <TimeStamp
                    value={ev.timestamp}
                    className="text-[10px] text-[var(--text-muted)] whitespace-nowrap shrink-0"
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('admin.security.timeline.noEvents', 'No state changes detected in the history.')} />
        )}
      </GlassPanel>
    </FadeIn>
  );
}
