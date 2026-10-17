import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { PrintButton } from '@/components/ui/PrintButton';
import { Caption, Text } from '@/components/ui/Typography';
import { CopyLinkButton } from '@/components/layout/CopyLinkButton';
import { cn } from '@/lib/cn';
import { useDateFormat } from '@/hooks/useDateFormat';
import type {
  PresentationDisplayConfig,
  PresentationMode,
} from '@/hooks/usePresentationMode';

export interface PresentationOverlayProps {
  mode: PresentationMode;
  config: PresentationDisplayConfig;
  isDimmed: boolean;
  isCursorHidden: boolean;
  dashboardCount?: number;
  currentIndex?: number;
  showRotation?: boolean;
  onExit: () => void;
}

export function PresentationOverlay({
  mode,
  config,
  isDimmed,
  isCursorHidden,
  dashboardCount = 0,
  currentIndex = 0,
  showRotation = true,
  onExit,
}: PresentationOverlayProps) {
  const { t } = useTranslation();
  const { formatTime, formatDateWithDay } = useDateFormat();
  const [now, setNow] = useState(new Date());
  const [showExit, setShowExit] = useState(false);

  useEffect(() => {
    if (mode !== 'kiosk' || !config.showClock) return undefined;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [config.showClock, mode]);

  useEffect(() => {
    if (mode !== 'kiosk') return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = () => {
      setShowExit(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setShowExit(false), 3000);
    };
    window.addEventListener('mousemove', show);
    window.addEventListener('touchstart', show);
    return () => {
      window.removeEventListener('mousemove', show);
      window.removeEventListener('touchstart', show);
      if (timer) clearTimeout(timer);
    };
  }, [mode]);

  if (mode === 'standard') return null;

  if (mode === 'report') {
    return (
      <div
        data-role="presentation-toolbar"
        data-print-hide
        className="fixed end-4 top-4 z-presentation-controls flex max-w-full flex-wrap items-center gap-1 rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] p-1 shadow-e2"
      >
        <Text size="xs" weight="medium" color="secondary" className="hidden min-w-0 items-center gap-1.5 break-words px-2 sm:flex">
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          {t('presentation.report.active', 'Report view')}
        </Text>
        <PrintButton iconOnly />
        <CopyLinkButton />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onExit}
          icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
          aria-label={t('presentation.exit', 'Exit presentation mode')}
          className="min-h-11 min-w-11 px-2 md:min-h-8 md:min-w-8"
        >
          <span className="hidden sm:inline">
            {t('presentation.exitShort', 'Exit')}
          </span>
        </Button>
      </div>
    );
  }

  const dimLevel = Number.isFinite(config.dimLevel)
    ? Math.min(1, Math.max(0, config.dimLevel))
    : 0.5;
  const dimOpacity = 1 - dimLevel;
  const clockPositionClass = {
    'top-left': 'left-4 top-4',
    'top-right': 'right-4 top-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  }[config.clockPosition];

  return (
    <>
      {isDimmed && (
        <div
          // Phase-45 / Prompt 04: NOT migrated to <Modal>. This non-interactive burn-in layer must cover the kiosk viewport.
          className="pointer-events-none fixed inset-0 z-presentation-dimmer bg-black transition-opacity duration-slow motion-reduce:transition-none"
          style={{ opacity: dimOpacity }}
          data-testid="kiosk-dim-overlay"
          aria-hidden="true"
        />
      )}

      {isCursorHidden && (
        <div
          // Phase-45 / Prompt 04: NOT migrated to <Modal>. This inert layer scopes cursor hiding across the kiosk viewport.
          className="pointer-events-none fixed inset-0 z-presentation-cursor"
          aria-hidden="true"
          data-testid="kiosk-cursor-style"
        >
          <style>{`[data-presentation-mode="kiosk"], [data-presentation-mode="kiosk"] * { cursor: none !important; }`}</style>
        </div>
      )}

      {config.showClock && (
        <div
          data-testid="kiosk-clock"
          className={cn(
            'pointer-events-none fixed z-presentation-controls select-none font-mono',
            clockPositionClass,
          )}
        >
          <Text as="div" size="2xl" color="muted" className="tabular-nums">
            {formatTime(now)}
          </Text>
          <Caption as="div">
            {formatDateWithDay(now)}
          </Caption>
        </div>
      )}

      {showRotation && dashboardCount > 1 && (
        <div
          className="pointer-events-none fixed bottom-4 left-1/2 z-presentation-controls flex -translate-x-1/2 items-center gap-1.5"
          role="group"
          aria-label={t(
            'kiosk.rotationPosition',
            'Dashboard {{current}} of {{total}}',
            {
              current: currentIndex + 1,
              total: dashboardCount,
            },
          )}
          data-testid="kiosk-rotation-dots"
        >
          {Array.from({ length: dashboardCount }).map((_, index) => (
            <span
              key={index}
              aria-hidden="true"
              className={cn(
                'h-1.5 rounded-full bg-[var(--surface-2)] transition-all duration-normal motion-reduce:transition-none',
                index === currentIndex ? 'w-6' : 'w-1.5',
              )}
            />
          ))}
        </div>
      )}

      <div
        className={cn(
          'fixed end-3 top-3 z-presentation-controls max-w-full transition-opacity duration-slow focus-within:opacity-100 motion-reduce:transition-none',
          showExit ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onExit}
          wrapLabel
          className="h-auto min-h-11 min-w-11 rounded-shape-sm border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-[var(--text-secondary)] shadow-e2 hover:bg-[var(--surface-3)] hover:text-[var(--text-primary)]"
          aria-label={t('kiosk.exit', 'Exit kiosk mode')}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          <Text variant="bodySm">
            {t('kiosk.exitLabel', 'Exit Kiosk')}
          </Text>
        </Button>
      </div>
    </>
  );
}
