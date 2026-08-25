import { useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Ellipsis,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Popover, Text, Tooltip } from '@/components/ui/runtime';
import type { UseBackgroundJobsResult } from '@/hooks/useBackgroundJobs';
import { cn } from '@/lib/cn';
import { ActiveVehicleSegment } from './ActiveVehicleSegment';
import { BackgroundWorkSegment } from './BackgroundWorkSegment';
import { HelpSegment } from './HelpSegment';
import { PresentationModeSegment } from './PresentationModeSegment';
import { useStatusBarPopover } from './StatusBarContext';
import { useBuildNews } from './useAboutBuild';

export interface MoreSegmentProps {
  backgroundJobs: UseBackgroundJobsResult;
  onOpenAbout: () => void;
  iconOnly?: boolean;
}

export function MoreSegment({
  backgroundJobs,
  onOpenAbout,
  iconOnly = false,
}: MoreSegmentProps) {
  const { t } = useTranslation();
  const { hasBuildNews } = useBuildNews();
  const { open, toggle, close } = useStatusBarPopover('more');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const label = t('statusBar.more.label', 'More');
  const hasError = backgroundJobs.jobs.some((job) => job.status === 'error');
  const hasRunning = backgroundJobs.jobs.some(
    (job) => job.status === 'running',
  );
  const backgroundSummary =
    backgroundJobs.count === 1
      ? backgroundJobs.jobs[0].label
      : t('statusBar.background.many', '{{count}} tasks', {
          count: backgroundJobs.count,
        });
  const backgroundState = hasError
    ? t(
        'statusBar.more.backgroundError',
        'Background work needs attention',
      )
    : hasRunning
      ? t('statusBar.background.tooltip', 'Background work in progress')
      : t('statusBar.more.backgroundComplete', 'Background work completed');
  const statusSummary = backgroundJobs.hasJobs
    ? `${backgroundState}: ${backgroundSummary}`
    : '';
  const buildNewsSummary = hasBuildNews
    ? t(
        'statusBar.help.buildNews',
        'Update or release notes available',
      )
    : '';
  const triggerSummary = [statusSummary, buildNewsSummary]
    .filter(Boolean)
    .join(' · ');
  const triggerLabel = t(
    'statusBar.more.open',
    'Open more status options',
  );
  const TriggerIcon = hasError
    ? AlertTriangle
    : hasRunning
      ? Loader2
      : backgroundJobs.hasJobs
        ? CheckCircle2
        : Ellipsis;
  const triggerTone = hasError
    ? 'text-rose-300'
    : hasRunning
      ? 'text-amber-300'
      : backgroundJobs.hasJobs
        ? 'text-emerald-300'
        : hasBuildNews
          ? 'text-amber-300'
          : 'text-[var(--text-muted)]';

  return (
    <>
      <Tooltip
        content={
          triggerSummary ||
          t('statusBar.more.tooltip', 'More status and help')
        }
        side="top"
      >
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={
            triggerSummary ? `${triggerLabel}. ${triggerSummary}` : triggerLabel
          }
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'relative h-5 min-h-0 gap-1.5 rounded px-1.5 py-0',
            triggerTone,
          )}
          data-testid="status-bar-more-trigger"
          data-tour="keyboard-hint"
        >
          <TriggerIcon
            className={cn(
              'h-3.5 w-3.5',
              hasRunning && 'animate-spin',
            )}
            aria-hidden
          />
          {!iconOnly && (
            <Text as="span" size="xs" weight="medium" color="secondary">
              {label}
            </Text>
          )}
          {hasBuildNews && (
            <span
              className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400"
              aria-hidden
            />
          )}
        </Button>
      </Tooltip>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        side="top"
        align="end"
        ariaLabel={label}
        className="max-h-[min(70vh,520px)] w-[min(92vw,320px)] overflow-y-auto"
      >
        <BackgroundWorkSegment
          embedded
          backgroundJobs={backgroundJobs}
        />
        <ActiveVehicleSegment embedded onSelect={close} />
        <PresentationModeSegment embedded onAction={close} />
        <HelpSegment
          embedded
          onAction={close}
          onOpenAbout={onOpenAbout}
        />
      </Popover>
    </>
  );
}
