import { useTranslation } from 'react-i18next';

interface GotoIndicatorProps {
  visible: boolean;
}

export function GotoIndicator({ visible }: GotoIndicatorProps) {
  const { t } = useTranslation();

  if (!visible) return null;

  return (
    <div
      data-testid="goto-indicator"
      role="status"
      aria-live="polite"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999]
      px-4 py-2 rounded-xl bg-[var(--surface-overlay)] backdrop-blur-xl border border-[var(--border-subtle)]
      text-sm text-[var(--text-primary)] shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-normal">
      <span className="text-[var(--text-muted)] mr-2">{t('shortcuts.gotoPrompt', 'Go to…')}</span>
      <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-xs font-mono text-[var(--text-secondary)]">g</kbd>
      <span className="text-[var(--text-muted)] mx-1" aria-hidden="true">+</span>
      <kbd className="px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-xs font-mono text-[var(--text-secondary)]">?</kbd>
    </div>
  );
}
