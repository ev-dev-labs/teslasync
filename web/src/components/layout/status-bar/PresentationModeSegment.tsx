import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Link2, MonitorUp } from 'lucide-react';
import { Button, PanelTitle, Popover, Text, Tooltip } from '@/components/ui/runtime';
import { useOptionalToast } from '@/components/feedback/Toast';
import {
  copyPresentationLink,
  usePresentationMode,
} from '@/hooks/usePresentationMode';
import { cn } from '@/lib/cn';
import { useStatusBarPopover } from './StatusBarContext';

export interface PresentationModeSegmentProps {
  iconOnly?: boolean;
  embedded?: boolean;
  onAction?: () => void;
}

export function PresentationModeSegment({
  iconOnly = false,
  embedded = false,
  onAction,
}: PresentationModeSegmentProps) {
  const { t } = useTranslation();
  const toast = useOptionalToast();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { open, toggle, close } = useStatusBarPopover('presentation');
  const { enterReport, enterKiosk } = usePresentationMode();
  const title = t('statusBar.presentation.title', 'Presentation');

  const run = (action: () => void | Promise<void>) => {
    close();
    onAction?.();
    void action();
  };

  const copyReportLink = async () => {
    try {
      await copyPresentationLink('report');
      toast?.success(
        t('presentation.report.linkCopied', 'Report link copied'),
      );
    } catch {
      toast?.error(
        t('presentation.report.linkError', 'Could not copy report link'),
      );
    }
  };

  const actions = (
    <div className="space-y-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => run(enterReport)}
        icon={<FileText className="h-4 w-4" aria-hidden="true" />}
        className="h-auto w-full justify-start px-2 py-2 text-left"
      >
        <span>
          <Text as="span" size="sm" weight="medium" color="primary">
            {t('presentation.report.open', 'Open report view')}
          </Text>
          <Text as="span" size="xs" color="muted" className="mt-0.5 block">
            {t(
              'presentation.report.help',
              'Clean navigation-free layout for printing and review.',
            )}
          </Text>
        </span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => run(copyReportLink)}
        icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
        className="h-auto w-full justify-start px-2 py-2 text-left"
      >
        <span>
          <Text as="span" size="sm" weight="medium" color="primary">
            {t('presentation.report.copyLink', 'Copy report link')}
          </Text>
          <Text as="span" size="xs" color="muted" className="mt-0.5 block">
            {t(
              'presentation.report.copyHelp',
              'Preserves the current route and filter query.',
            )}
          </Text>
        </span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => run(enterKiosk)}
        icon={<MonitorUp className="h-4 w-4" aria-hidden="true" />}
        className="h-auto w-full justify-start px-2 py-2 text-left"
      >
        <span>
          <Text as="span" size="sm" weight="medium" color="primary">
            {t('presentation.kiosk.open', 'Open kiosk view')}
          </Text>
          <Text as="span" size="xs" color="muted" className="mt-0.5 block">
            {t(
              'presentation.kiosk.help',
              'Fullscreen monitoring with idle cursor and screen dimming.',
            )}
          </Text>
        </span>
      </Button>
    </div>
  );

  if (embedded) {
    return (
      <section className="border-t border-[var(--border-subtle)] p-3">
        <PanelTitle>{title}</PanelTitle>
        <div className="mt-2">{actions}</div>
      </section>
    );
  }

  return (
    <>
      <Tooltip
        content={t(
          'statusBar.presentation.tooltip',
          'Report and kiosk views',
        )}
        side="top"
      >
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t(
            'statusBar.presentation.open',
            'Open presentation options',
          )}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0',
            'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          )}
          data-testid="status-bar-presentation-trigger"
        >
          <MonitorUp className="h-3.5 w-3.5" aria-hidden="true" />
          {!iconOnly && (
            <Text as="span" size="xs" weight="medium" color="secondary">
              {t('statusBar.presentation.short', 'Present')}
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
        ariaLabel={title}
        className="w-[min(92vw,340px)] p-2"
      >
        <div className="border-b border-[var(--border-subtle)] px-2 pb-2 pt-1">
          <PanelTitle>{title}</PanelTitle>
          <Text as="p" size="xs" color="muted" className="mt-0.5">
            {t(
              'statusBar.presentation.description',
              'Prepare the active view for review or unattended display.',
            )}
          </Text>
        </div>
        <div className="pt-1">{actions}</div>
      </Popover>
    </>
  );
}
