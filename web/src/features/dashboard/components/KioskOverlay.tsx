import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button as UiButton } from '@/components/ui';
import { DEFAULT_KIOSK_CONFIG, type KioskConfig } from '../hooks/useKioskMode';
import { useDateFormat } from '@/hooks/useDateFormat';

interface KioskOverlayProps {
  config: KioskConfig;
  isDimmed: boolean;
  isCursorHidden: boolean;
  dashboardCount: number;
  currentIndex: number;
  onExit: () => void;
}

export function KioskOverlay({
  config,
  isDimmed,
  isCursorHidden,
  dashboardCount,
  currentIndex,
  onExit,
}: KioskOverlayProps) {
  const { t } = useTranslation();
  const { formatTime, formatDateWithDay } = useDateFormat();
  const [now, setNow] = useState(new Date());
  const [showExit, setShowExit] = useState(false);

  // Darkness of the black wallpaper when the screen is dimmed. `dimLevel` is
  // the *remaining* brightness (0–1) chosen in kiosk settings ("Dimmed
  // Brightness"), so the overlay darkens by `1 - dimLevel`. Guard against a
  // missing / NaN / out-of-range value so we never emit invalid CSS opacity.
  const safeDimLevel = Number.isFinite(config.dimLevel)
    ? config.dimLevel
    : DEFAULT_KIOSK_CONFIG.dimLevel;
  const dimOpacity = Math.min(1, Math.max(0, 1 - safeDimLevel));

  // Clock tick
  useEffect(() => {
    if (!config.showClock) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [config.showClock]);

  // Brief exit hint on any interaction
  useEffect(() => {
    const show = () => {
      setShowExit(true);
      clearTimeout(timer);
      timer = setTimeout(() => setShowExit(false), 3000);
    };
    let timer: ReturnType<typeof setTimeout>;
    window.addEventListener('mousemove', show);
    window.addEventListener('touchstart', show);
    return () => {
      window.removeEventListener('mousemove', show);
      window.removeEventListener('touchstart', show);
      clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {/* Dim overlay — pointer-events-none so it doesn't block interaction */}
      {isDimmed && (
        <div
          // Non-interactive kiosk wallpaper layer for ambient screen dimming.
          // Not a dialog; new interactive dialogs MUST use <Modal>.
          // eslint-disable-next-line no-restricted-syntax
          className="fixed inset-0 z-[9998] bg-black pointer-events-none transition-opacity duration-slow"
          style={{ opacity: dimOpacity }}
          data-testid="kiosk-dim-overlay"
          aria-hidden="true"
        />
      )}

      {/* Cursor hiding — scoped to kiosk root via parent className */}
      {isCursorHidden && (
        // Non-interactive kiosk wallpaper layer that injects cursor-hiding CSS.
        // Not a dialog; new interactive dialogs MUST use <Modal>.
        <div
          // eslint-disable-next-line no-restricted-syntax
          className="fixed inset-0 z-[9997] pointer-events-none"
          aria-hidden="true"
          data-testid="kiosk-cursor-style"
        >
          <style>{`.kiosk-root, .kiosk-root * { cursor: none !important; }`}</style>
        </div>
      )}

      {/* Clock overlay */}
      {config.showClock && (
        <div
          data-testid="kiosk-clock"
          className={cn(
            'fixed z-[9999] font-mono pointer-events-none select-none',
            config.clockPosition === 'top-left' && 'top-4 left-4',
            config.clockPosition === 'top-right' && 'top-4 right-4',
            config.clockPosition === 'bottom-left' && 'bottom-4 left-4',
            config.clockPosition === 'bottom-right' && 'bottom-4 right-4',
          )}
        >
          <div className="text-2xl text-[var(--text-muted)] tabular-nums">
            {formatTime(now)}
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            {formatDateWithDay(now)}
          </div>
        </div>
      )}

      {/* Dashboard rotation indicator dots */}
      {dashboardCount > 1 && config.rotateInterval > 0 && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-1.5 pointer-events-none"
          role="group"
          aria-label={t('kiosk.rotationPosition', 'Dashboard {{current}} of {{total}}', {
            current: (currentIndex ?? 0) + 1,
            total: dashboardCount,
          })}
          data-testid="kiosk-rotation-dots"
        >
          {Array.from({ length: dashboardCount }).map((_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className={cn(
                'h-1.5 rounded-full transition-all duration-normal',
                i === currentIndex
                  ? 'w-6 bg-[var(--surface-2)]'
                  : 'w-1.5 bg-[var(--surface-2)]',
              )}
            />
          ))}
        </div>
      )}

      {/* Exit button — fades in on mouse movement or keyboard focus, always accessible via touch */}
      <div
        className={cn(
          'fixed top-3 right-3 z-[9999] transition-opacity duration-slow focus-within:opacity-100',
          showExit ? 'opacity-100' : 'opacity-0',
        )}
      >
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={onExit}
          className="h-auto px-3 py-2 rounded-lg bg-[var(--surface-overlay)] backdrop-blur-sm
            text-[var(--text-secondary)] text-xs hover:text-[var(--text-primary)] hover:bg-[var(--surface-overlay)] transition-colors
            focus:ring-white/20 focus:ring-offset-0"
          aria-label={t('kiosk.exit', 'Exit kiosk mode')}
        >
          <X className="h-3.5 w-3.5" />
          {t('kiosk.exitLabel', 'Exit Kiosk')}
        </UiButton>
      </div>
    </>
  );
}
