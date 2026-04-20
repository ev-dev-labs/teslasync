import { useTranslation } from 'react-i18next';

interface GotoIndicatorProps {
  visible: boolean;
}

export function GotoIndicator({ visible }: GotoIndicatorProps) {
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999]
      px-4 py-2 rounded-xl bg-black/80 backdrop-blur-xl border border-white/10
      text-sm text-white/80 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200">
      <span className="text-white/40 mr-2">{t('shortcuts.goto', 'Go to...')}</span>
      <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-xs font-mono text-white/60">g</kbd>
      <span className="text-white/30 mx-1">+</span>
      <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-xs font-mono text-white/60">?</kbd>
    </div>
  );
}
