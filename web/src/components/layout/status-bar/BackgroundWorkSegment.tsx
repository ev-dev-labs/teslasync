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
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { PanelTitle, Text } from '@/components/ui/Typography';
import { Tooltip } from '@/components/ui/Tooltip';
import type {
  BackgroundJobKind,
  UseBackgroundJobsResult,
} from '@/hooks/useBackgroundJobs';
import { cn } from '@/lib/cn';
import { neonColorMap, typography } from '@/lib/tokens';
import { useMotionPreference } from '@/hooks/useMotionPreference';
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
  const { reduce } = useMotionPreference();
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
    ? neonColorMap.red.text
    : hasRunning
      ? neonColorMap.cyan.text
      : neonColorMap.green.text;
  const TriggerIcon = hasError ? AlertTriangle : hasRunning ? Loader2 : CheckCircle2;

  const jobList = (
    <div className="space-y-1 p-2">
      <PanelTitle className="px-1.5 pb-1">
        {hasRunning
          ? t('statusBar.background.heading', 'Running')
          : t('statusBar.background.recentHeading', 'Recent activity')}
      </PanelTitle>
      {jobs.map((job) => {
        const JobIcon = KIND_ICON[job.kind] ?? Sparkles;
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
            ? neonColorMap.red.text
            : status === 'success'
              ? neonColorMap.green.text
              : neonColorMap.cyan.text;
        return (
          <div
            key={job.id}
            className="flex items-start gap-2 rounded-md px-1.5 py-1 text-[var(--text-secondary)]"
          >
            <Icon
              icon={JobIcon}
              size="sm"
              className={cn('mt-0.5', typography.color.muted)}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <Text
                as="span"
                size="xs"
                weight="medium"
                color="primary"
                className="block break-words"
              >
                {job.label}
              </Text>
              {job.description && (
                <Text as="span" variant="caption" className="block break-words">
                  {job.description}
                </Text>
              )}
            </span>
            <Icon
              icon={OutcomeIcon}
              size="xs"
              className={cn(
                outcomeTone,
                status === 'running' && !reduce && 'animate-spin motion-reduce:animate-none',
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
            'h-11 min-w-11 gap-1.5 rounded-shape-sm px-1.5 py-0 md:h-6 md:min-h-6 md:min-w-6',
            typography.size.xs,
            triggerTone,
          )}
        >
          <Icon
            icon={TriggerIcon}
            size="xs"
            className={cn(hasRunning && !reduce && 'animate-spin motion-reduce:animate-none')}
            aria-hidden
          />
          {!iconOnly && (
            <Text
              as="span"
              size="xs"
              weight="medium"
              className="max-w-background-summary truncate"
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
        className="max-h-status-options min-w-background-work overflow-y-auto"
      >
        {jobList}
      </Popover>
    </div>
  );
}
