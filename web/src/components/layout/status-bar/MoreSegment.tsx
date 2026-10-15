import { useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Ellipsis,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { Text } from '@/components/ui/Typography';
import { Tooltip } from '@/components/ui/Tooltip';
import type { UseBackgroundJobsResult } from '@/hooks/useBackgroundJobs';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { cn } from '@/lib/cn';
import { neonColorMap, typography } from '@/lib/tokens';
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
  const { reduce } = useMotionPreference();
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
    ? neonColorMap.red.text
    : hasRunning
      ? neonColorMap.amber.text
      : backgroundJobs.hasJobs
        ? neonColorMap.green.text
        : hasBuildNews
          ? neonColorMap.amber.text
          : typography.color.muted;

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
          wrapLabel
          aria-label={
            triggerSummary ? `${triggerLabel}. ${triggerSummary}` : triggerLabel
          }
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'relative h-auto min-h-11 min-w-11 shrink-0 gap-1.5 rounded px-1.5 py-0 md:h-5 md:min-h-0 md:min-w-0',
            triggerTone,
          )}
          data-testid="status-bar-more-trigger"
          data-tour="keyboard-hint"
        >
          <Icon
            icon={TriggerIcon}
            size="sm"
            className={cn(
              hasRunning && !reduce && 'animate-spin motion-reduce:animate-none',
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
              className={cn(
                'absolute end-0.5 top-0.5 h-1.5 w-1.5 rounded-full',
                neonColorMap.amber.dot,
              )}
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
        className="max-h-more-menu w-connection-diagnostics overflow-y-auto"
      >
        <BackgroundWorkSegment
          embedded
          backgroundJobs={backgroundJobs}
        />
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
