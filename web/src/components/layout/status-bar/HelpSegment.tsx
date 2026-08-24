import { useRef } from 'react';
import { Bug, CircleHelp, Compass, Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, PanelTitle, Popover, Text, Tooltip } from '@/components/ui';
import { dispatchTourLauncherOpen } from '@/lib/tourRegistry';
import { cn } from '@/lib/cn';
import { VersionSegment } from './VersionSegment';
import { useStatusBarPopover } from './StatusBarContext';
import { useBuildNews } from './useAboutBuild';

export interface HelpSegmentProps {
  onOpenAbout: () => void;
  iconOnly?: boolean;
  embedded?: boolean;
  onAction?: () => void;
}

export function HelpSegment({
  onOpenAbout,
  iconOnly = false,
  embedded = false,
  onAction,
}: HelpSegmentProps) {
  const { t } = useTranslation();
  const { open, toggle, close } = useStatusBarPopover('help');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { hasBuildNews } = useBuildNews();

  const runAndClose = (action: () => void) => {
    close();
    onAction?.();
    action();
  };

  const menu = (
    <div className="p-1" data-testid="status-bar-help-menu">
      <PanelTitle className="px-3 pb-1 pt-2">
        {t('statusBar.help.title', 'Help & support')}
      </PanelTitle>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('help.shortcuts', 'Open keyboard shortcuts')}
        onClick={() =>
          runAndClose(() =>
            window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts')),
          )
        }
        className="h-auto min-h-9 w-full justify-start px-3 py-2 text-[var(--text-secondary)]"
      >
        <Keyboard className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <Text as="span" size="xs" weight="medium">
          {t('help.shortcutsLabel', 'Keyboard shortcuts')}
        </Text>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('help.tour', 'Open tour launcher')}
        onClick={() => runAndClose(dispatchTourLauncherOpen)}
        className="h-auto min-h-9 w-full justify-start px-3 py-2 text-[var(--text-secondary)]"
        data-tour-launcher-trigger
      >
        <Compass className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <Text as="span" size="xs" weight="medium">
          {t('help.tourLabel', 'Take a tour')}
        </Text>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t('help.feedback', 'Open feedback / bug report form')}
        onClick={() =>
          runAndClose(() =>
            window.dispatchEvent(new CustomEvent('open-feedback-modal')),
          )
        }
        className="h-auto min-h-9 w-full justify-start px-3 py-2 text-[var(--text-secondary)]"
        data-testid="status-bar-feedback-trigger"
      >
        <Bug className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <Text as="span" size="xs" weight="medium">
          {t('help.feedbackLabel', 'Report a problem')}
        </Text>
      </Button>
      <div className="mt-1 border-t border-[var(--border-subtle)] pt-1">
        <VersionSegment
          variant="menu"
          aboutOpen={false}
          onOpenAbout={() => runAndClose(onOpenAbout)}
        />
      </div>
    </div>
  );

  if (embedded) {
    return (
      <section data-testid="status-bar-help-embedded">
        {menu}
      </section>
    );
  }

  const openLabel = t('statusBar.help.open', 'Open help and about');
  const tooltipLabel = t('statusBar.help.tooltip', 'Help and about');
  const buildNewsLabel = t(
    'statusBar.help.buildNews',
    'Update or release notes available',
  );

  return (
    <>
      <Tooltip
        content={
          hasBuildNews ? `${tooltipLabel} · ${buildNewsLabel}` : tooltipLabel
        }
        side="top"
      >
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={
            hasBuildNews ? `${openLabel}. ${buildNewsLabel}` : openLabel
          }
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'relative h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 text-xs leading-none',
            'text-[var(--text-muted)]',
          )}
          data-tour="keyboard-hint"
        >
          <CircleHelp className="h-3 w-3 shrink-0" aria-hidden />
          {!iconOnly && (
            <Text as="span" size="xs" weight="medium" color="secondary">
              {t('statusBar.help.short', 'Help')}
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
        ariaLabel={t('statusBar.help.title', 'Help & support')}
        className="w-[min(92vw,260px)]"
      >
        {menu}
      </Popover>
    </>
  );
}
