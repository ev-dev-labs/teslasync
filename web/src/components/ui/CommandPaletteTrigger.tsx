import { useTranslation } from 'react-i18next'
import { Icons } from '@/lib/icons'
import { captureAppDesignOrigin } from './appDesignOrigin'
import { Button } from './Button'
import { cn } from '@/lib/cn'

export function loadCommandPalette() {
  return import('./CommandPalette')
}

/** Lightweight command-palette trigger that preloads the full palette on intent. */
export function CommandPaletteTrigger({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const preload = () => {
    void loadCommandPalette()
  }

  return (
    <Button
      type="button"
      variant={compact ? 'ghost' : 'secondary'}
      onMouseEnter={preload}
      onFocus={preload}
      onClick={(event) => {
        const origin = event.currentTarget
        const designOrigin = captureAppDesignOrigin(origin)
        preload()
        window.dispatchEvent(new CustomEvent('toggle-command-palette', { detail: { origin, designOrigin } }))
      }}
      aria-label={t('palette.placeholder', 'Search pages, commands…')}
      aria-keyshortcuts="Control+K Meta+K"
      className={cn(compact ? 'horizontal-nav-icon'
        : 'flex h-auto w-full items-center gap-3 rounded-shape-md px-3 py-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]')}
    >
      <Icons.search className={compact ? 'size-5' : 'size-4'} aria-hidden="true" />
      {!compact && <><span className="min-w-0 flex-1 truncate text-left">
        {t('palette.placeholder', 'Search pages, commands…')}
      </span>
      <kbd className="hidden items-center gap-0.5 rounded-shape-sm border border-[var(--border-default)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-2xs text-[var(--text-muted)] sm:flex">
        <Icons.keyboard className="h-2.5 w-2.5" aria-hidden="true" />K
      </kbd></>}
    </Button>
  )
}
