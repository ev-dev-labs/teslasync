import { Bug, Compass, Keyboard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PanelTitle, Text } from '@/components/ui/Typography';
import { dispatchTourLauncherOpen } from '@/lib/tourRegistry';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { VersionSegment } from './VersionSegment';

interface HelpMenuContentProps {
  close: () => void;
  onAction?: () => void;
  onOpenAbout: () => void;
}

export function HelpMenuContent({ close, onAction, onOpenAbout }: HelpMenuContentProps) {
  const { t } = useTranslation();
  const menuActionClassName = cn(
    'h-auto min-h-11 min-w-11 w-full justify-start px-3 py-2 md:min-h-9 md:min-w-0',
    typography.color.secondary,
  );

  const runAndClose = (action: () => void) => {
    close();
    onAction?.();
    action();
  };

  return (
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
}
