import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { KioskConfig } from '../hooks/useKioskMode';

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
  const [now, setNow] = useState(new Date());
  const [showExit, setShowExit] = useState(false);

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
          className="fixed inset-0 z-[9998] bg-black pointer-events-none transition-opacity duration-1000"
          style={{ opacity: 1 - config.dimLevel }}
        />
      )}

      {/* Cursor hiding — scoped to kiosk root via parent className */}
      {isCursorHidden && (
        <div className="fixed inset-0 z-[9997] pointer-events-none" aria-hidden="true">
          <style>{`.kiosk-root, .kiosk-root * { cursor: none !important; }`}</style>
        </div>
      )}

      {/* Clock overlay */}
      {config.showClock && (
        <div
          className={cn(
            'fixed z-[9999] font-mono pointer-events-none select-none',
            config.clockPosition === 'top-left' && 'top-4 left-4',
            config.clockPosition === 'top-right' && 'top-4 right-4',
            config.clockPosition === 'bottom-left' && 'bottom-4 left-4',
            config.clockPosition === 'bottom-right' && 'bottom-4 right-4',
          )}
        >
          <div className="text-2xl text-white/20 tabular-nums">
            {now.toLocaleTimeString()}
          </div>
          <div className="text-xs text-white/15">
            {now.toLocaleDateString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </div>
        </div>
      )}

      {/* Dashboard rotation indicator dots */}
      {dashboardCount > 1 && config.rotateInterval > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-1.5 pointer-events-none">
          {Array.from({ length: dashboardCount }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === currentIndex
                  ? 'w-6 bg-white/40'
                  : 'w-1.5 bg-white/15',
              )}
            />
          ))}
        </div>
      )}

      {/* Exit button — fades in on mouse movement, always accessible via touch */}
      <div
        className={cn(
          'fixed top-3 right-3 z-[9999] transition-opacity duration-500',
          showExit ? 'opacity-100' : 'opacity-0',
        )}
      >
        <button
          onClick={onExit}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-sm
            text-white/50 text-xs hover:text-white/90 hover:bg-black/80 transition-colors
            focus:outline-none focus:ring-2 focus:ring-white/20"
          aria-label={t('kiosk.exit', 'Exit kiosk mode')}
        >
          <X className="h-3.5 w-3.5" />
          {t('kiosk.exitLabel', 'Exit Kiosk')}
        </button>
      </div>
    </>
  );
}
