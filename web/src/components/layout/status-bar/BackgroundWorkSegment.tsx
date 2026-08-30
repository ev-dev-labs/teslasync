import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileDown,
  Save,
  Sparkles,
} from 'lucide-react';
import { Button, PanelTitle, Popover, Text, Tooltip } from '@/components/ui/runtime';
import type {
  BackgroundJobKind,
  UseBackgroundJobsResult,
} from '@/hooks/useBackgroundJobs';
import { cn } from '@/lib/cn';
import { useStatusBarPopover } from './StatusBarContext';

/**
 * BackgroundWorkSegment.
 *
 * Footer status-bar segment that surfaces in-flight background work and
 * short-lived completion/failure outcomes. Hidden when there is no active or
 * recent work so the bar stays quiet during normal use.
 */

interface BackgroundWorkSegmentProps {
  backgroundJobs: UseBackgroundJobsResult;
  iconOnly?: boolean;
  embedded?: boolean;
}

const KIND_ICON: Record<BackgroundJobKind, typeof FileDown> = {
  export: FileDown,
  mutation: Save,
  custom: Sparkles,
};

export function BackgroundWorkSegment({
  backgroundJobs,
  iconOnly = false,
  embedded = false,
}: BackgroundWorkSegmentProps) {
  const { t } = useTranslation();
  const { jobs, count, hasJobs } = backgroundJobs;
  const { open, toggle, close } = useStatusBarPopover('background');
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!embedded && !hasJobs) close();
  }, [close, embedded, hasJobs]);

  if (!hasJobs) return null;

  const hasError = jobs.some((job) => job.status === 'error');
  const hasRunning = jobs.some(
    (job) => job.status !== 'success' && job.status !== 'error',
  );
  const summary =
    count === 1
      ? jobs[0].label
      : t('statusBar.background.many', '{{count}} tasks', { count });

  const tooltip = (
    <span>
      {hasRunning
        ? t('statusBar.background.tooltip', 'Background work in progress')
        : t('statusBar.background.recentTooltip', 'Recent background activity')}{' '}
      · {summary}
    </span>
  );

  const triggerTone = hasError
    ? 'text-rose-300'
    : hasRunning
      ? 'text-amber-300'
      : 'text-emerald-300';
  const TriggerIcon = hasError ? AlertTriangle : hasRunning ? Loader2 : CheckCircle2;

  const jobList = (
    <div className="space-y-1 p-2">
      <PanelTitle className="px-1.5 pb-1">
        {hasRunning
          ? t('statusBar.background.heading', 'Running')
          : t('statusBar.background.recentHeading', 'Recent activity')}
      </PanelTitle>
      {jobs.map((job) => {
        const Icon = KIND_ICON[job.kind] ?? Sparkles;
        const status =
          job.status === 'success' || job.status === 'error'
            ? job.status
            : 'running';
        const OutcomeIcon =
          status === 'error'
            ? AlertTriangle
            : status === 'success'
              ? CheckCircle2
              : Loader2;
        const outcomeTone =
          status === 'error'
            ? 'text-rose-300'
            : status === 'success'
              ? 'text-emerald-300'
              : 'text-amber-300';
        return (
          <div
            key={job.id}
            className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[var(--text-secondary)]"
          >
            <Icon
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <Text
                as="span"
                size="xs"
                weight="medium"
                color="primary"
                className="block truncate"
              >
                {job.label}
              </Text>
              {job.description && (
                <Text as="span" size="2xs" color="muted" className="block truncate">
                  {job.description}
                </Text>
              )}
            </span>
            <OutcomeIcon
              className={cn(
                'h-3 w-3 shrink-0',
                outcomeTone,
                status === 'running' && 'animate-spin',
              )}
              aria-hidden
            />
          </div>
        );
      })}
    </div>
  );

  if (embedded) {
    return (
      <section
        className="border-b border-[var(--border-subtle)] last:border-b-0"
        data-testid="status-bar-background-embedded"
      >
        {jobList}
      </section>
    );
  }

  return (
    <div className="relative inline-flex">
      <Tooltip content={tooltip} side="top">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${t('statusBar.background.aria', 'Background tasks')}: ${summary}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 text-xs leading-none',
            triggerTone,
          )}
        >
          <TriggerIcon
            className={cn('h-3 w-3 shrink-0', hasRunning && 'animate-spin')}
            aria-hidden
          />
          {!iconOnly && (
            <Text
              as="span"
              size="xs"
              weight="medium"
              className="max-w-[180px] truncate"
            >
              {summary}
            </Text>
          )}
        </Button>
      </Tooltip>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        side="top"
        align="end"
        ariaLabel={t('statusBar.background.aria', 'Background tasks')}
        className="max-h-[280px] min-w-[260px] overflow-y-auto"
      >
        {jobList}
      </Popover>
    </div>
  );
}
