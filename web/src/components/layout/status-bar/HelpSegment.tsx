import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { CircleHelp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Popover } from '@/components/ui/Popover';
import { Text } from '@/components/ui/Typography';
import { Tooltip } from '@/components/ui/Tooltip';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { reportFrontendError } from '@/lib/errorReporter';
import { cn } from '@/lib/cn';
import { severityTokens, typography } from '@/lib/tokens';
import type { HelpMenuContent } from './HelpMenuContent';
import { useStatusBarPopover } from './StatusBarContext';
import { useBuildNews } from './useAboutBuild';

export interface HelpSegmentProps {
  onOpenAbout: () => void;
  iconOnly?: boolean;
  embedded?: boolean;
  onAction?: () => void;
}

function HelpMenuBody(props: ComponentProps<typeof HelpMenuContent>) {
  const { t } = useTranslation();
  const [Content, setContent] = useState<typeof HelpMenuContent | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    void import('./HelpMenuContent').then(module => {
      if (!cancelled) setContent(() => module.HelpMenuContent);
    }, error => {
      if (cancelled) return;
      reportFrontendError(error, 'react');
      setLoadFailed(true);
    });
    return () => { cancelled = true; };
  }, [attempt]);

  useLayoutEffect(() => {
    if (Content && bodyRef.current?.contains(document.activeElement)) {
      bodyRef.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    }
  }, [Content]);

  return (
    <div ref={bodyRef} tabIndex={-1}>
      {Content ? <Content {...props} /> : loadFailed ? (
        <AlertBanner variant="danger" role="alert">
          {t('errorBoundary.inlineTitle', 'Component failed to load')}
          <Button variant="secondary" onClick={() => {
            bodyRef.current?.focus({ preventScroll: true });
            setAttempt(value => value + 1);
          }}>
            {t('error.retry', 'Retry')}
          </Button>
        </AlertBanner>
      ) : <Text role="status">{t('a11y.loading', 'Loading')}</Text>}
    </div>
  );
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
  const menu = <HelpMenuBody close={close} onAction={onAction} onOpenAbout={onOpenAbout} />;

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
