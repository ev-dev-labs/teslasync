import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { FadeIn } from '@/components/motion/FadeIn';
import type { SecurityEvent } from '@/types/admin';
import { parseWindowState, windowColor, windowTextClass } from './helpers';

const WINDOW_KEYS = [
  { key: 'fdWindow' as const, i18nKey: 'admin.security.window.fd', fallback: 'Front Driver' },
  { key: 'fpWindow' as const, i18nKey: 'admin.security.window.fp', fallback: 'Front Passenger' },
  { key: 'rdWindow' as const, i18nKey: 'admin.security.window.rd', fallback: 'Rear Driver' },
  { key: 'rpWindow' as const, i18nKey: 'admin.security.window.rp', fallback: 'Rear Passenger' },
] as const;

interface WindowStatusDetailProps {
  latest: SecurityEvent | undefined;
}

export function WindowStatusDetail({ latest }: WindowStatusDetailProps) {
  const { t } = useTranslation();

  return (
    <FadeIn delay={0.15}>
      <h2 className="text-lg font-semibold text-gray-200 mb-3">
        {t('admin.security.windowDetail', 'Window Status Detail')}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {WINDOW_KEYS.map((win) => {
          const state = parseWindowState(latest?.[win.key]);
          return (
            <GlassPanel
              key={win.key}
              className={cn('p-4 border', windowColor(state))}
            >
              <p className="text-xs text-[var(--text-muted)] mb-1">{t(win.i18nKey, win.fallback)}</p>
              <p className={cn('text-xl font-bold', windowTextClass(state))}>
                {t(`admin.security.windowState.${(state ?? '').toLowerCase()}`, state)}
              </p>
            </GlassPanel>
          );
        })}
      </div>
    </FadeIn>
  );
}
