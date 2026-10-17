import { useRef } from 'react';
import { Bug, CircleHelp, Compass, Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { PanelTitle, Text } from '@/components/ui/Typography';
import { Tooltip } from '@/components/ui/Tooltip';
import { dispatchTourLauncherOpen } from '@/lib/tourRegistry';
import { cn } from '@/lib/cn';
import { severityTokens, typography } from '@/lib/tokens';
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
  const menuActionClassName = cn(
    'h-auto min-h-11 min-w-11 w-full justify-start px-3 py-2 md:min-h-9 md:min-w-0',
    typography.color.secondary,
  );

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
        wrapLabel
        aria-label={t('help.shortcuts', 'Open keyboard shortcuts')}
        onClick={() =>
          runAndClose(() =>
            window.dispatchEvent(new CustomEvent('toggle-keyboard-shortcuts')),
          )
        }
        className={menuActionClassName}
        icon={<Icon icon={Keyboard} size="sm" />}
      >
        <Text as="span" size="xs" weight="medium">
          {t('help.shortcutsLabel', 'Keyboard shortcuts')}
        </Text>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        wrapLabel
        aria-label={t('help.tour', 'Open tour launcher')}
        onClick={() => runAndClose(dispatchTourLauncherOpen)}
        className={menuActionClassName}
        icon={<Icon icon={Compass} size="sm" />}
        data-tour-launcher-trigger
      >
        <Text as="span" size="xs" weight="medium">
          {t('help.tourLabel', 'Take a tour')}
        </Text>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        wrapLabel
        aria-label={t('help.feedback', 'Open feedback / bug report form')}
        onClick={() =>
          runAndClose(() =>
            window.dispatchEvent(new CustomEvent('open-feedback-modal')),
          )
        }
        className={menuActionClassName}
        icon={<Icon icon={Bug} size="sm" />}
        data-testid="status-bar-feedback-trigger"
      >
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
            'relative h-11 min-h-11 min-w-11 shrink-0 gap-1.5 px-1.5 py-0 leading-none md:h-5 md:min-h-0 md:min-w-0',
            typography.role.caption,
          )}
          data-tour="keyboard-hint"
        >
          <Icon icon={CircleHelp} size="xs" />
          {!iconOnly && (
            <Text as="span" size="xs" weight="medium" color="secondary">
              {t('statusBar.help.short', 'Help')}
            </Text>
          )}
          {hasBuildNews && (
            <span
              className={cn(
                'absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full',
                severityTokens.warn.dot,
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
        ariaLabel={t('statusBar.help.title', 'Help & support')}
        className="w-help-menu"
      >
        {menu}
      </Popover>
    </>
  );
}
