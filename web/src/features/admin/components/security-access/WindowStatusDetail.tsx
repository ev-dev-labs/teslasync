import { useTranslation } from 'react-i18next';
import { AppWindow } from 'lucide-react';
import { cn } from '@/lib/cn';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { Skeleton, QueryError } from '@/components/feedback';
import type { SecurityEvent } from '@/types/admin';
import { parseWindowState, windowTone } from './helpers';
import { StatusTile } from './StatusTile';

const WINDOW_KEYS = [
  { key: 'fdWindow' as const, i18nKey: 'admin.security.window.fd', fallback: 'Front Driver' },
  { key: 'fpWindow' as const, i18nKey: 'admin.security.window.fp', fallback: 'Front Passenger' },
  { key: 'rdWindow' as const, i18nKey: 'admin.security.window.rd', fallback: 'Rear Driver' },
  { key: 'rpWindow' as const, i18nKey: 'admin.security.window.rp', fallback: 'Rear Passenger' },
] as const;

/** 2×2 grid mirroring the physical front/rear × driver/passenger layout. */
const GRID_CLASS = 'grid grid-cols-2 gap-3';

interface WindowStatusDetailProps {
  latest: SecurityEvent | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/** Per-window position detail (front/rear × driver/passenger). */
export function WindowStatusDetail({ latest, isLoading, error, onRetry, className }: WindowStatusDetailProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)}>
      <PanelTitle className="mb-3">{t('admin.security.windowDetail', 'Window Status Detail')}</PanelTitle>
      {error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <div aria-hidden="true" className={GRID_CLASS}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={104} />
          ))}
        </div>
      ) : (
        <div
          role="group"
          aria-label={t('admin.security.window.aria', 'Window status by position')}
          className={GRID_CLASS}
        >
          {WINDOW_KEYS.map((win) => {
            const state = parseWindowState(latest?.[win.key]);
            return (
              <StatusTile
                key={win.key}
                icon={<AppWindow className="h-5 w-5" />}
                tone={windowTone(state)}
                label={t(win.i18nKey, win.fallback)}
                value={t(`admin.security.windowState.${state.toLowerCase()}`, state)}
              />
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
