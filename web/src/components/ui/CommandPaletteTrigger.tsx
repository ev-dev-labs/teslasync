import { useTranslation } from 'react-i18next'
import { Icons } from '@/lib/icons'

export function loadCommandPalette() {
  return import('./CommandPalette')
}

/** Lightweight command-palette trigger that preloads the full palette on intent. */
export function CommandPaletteTrigger() {
  const { t } = useTranslation()
  const preload = () => {
    void loadCommandPalette()
  }

  return (
    <button
      type="button"
      onMouseEnter={preload}
      onFocus={preload}
      onClick={() => {
        preload()
        window.dispatchEvent(new CustomEvent('toggle-command-palette'))
      }}
      aria-label={t('palette.placeholder', 'Search pages, commands…')}
      className="flex w-full items-center gap-3 rounded-shape-md border border-[var(--control-border)] bg-[var(--control-bg)] px-3 py-2 text-sm text-[var(--text-muted)] transition-colors hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      <Icons.search className="h-4 w-4" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">
        {t('palette.placeholder', 'Search pages, commands…')}
      </span>
      <kbd className="hidden items-center gap-0.5 rounded-shape-sm border border-[var(--border-default)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-2xs text-[var(--text-muted)] sm:flex">
        <Icons.keyboard className="h-2.5 w-2.5" aria-hidden="true" />K
      </kbd>
    </button>
  )
}
