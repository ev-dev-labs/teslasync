import { lazy, Suspense, useEffect, useState, type RefObject } from 'react'
import { loadCommandPalette } from '@/components/ui/CommandPaletteTrigger'
import { readAppDesignInvocation, type AppDesignInvocation } from '@/components/ui/appDesignOrigin'

const LazyCommandPalette = lazy(async () => {
  const module = await loadCommandPalette()
  return { default: module.CommandPalette }
})

export interface CommandPaletteHostProps {
  onOpen?: () => void
  returnFocusFallbackRef?: RefObject<HTMLElement | null>
  onPin?: (path: string) => void
  onUnpin?: (path: string) => void
}

/**
 * Defers the command center and its entity-search dependencies until the
 * first invocation. Preserve that event's explicit or focused origin across the lazy
 * import; subsequent events are handled by the mounted palette itself.
 */
export function CommandPaletteHost({ onOpen, returnFocusFallbackRef, onPin, onUnpin }: CommandPaletteHostProps) {
  const [activation, setActivation] = useState<AppDesignInvocation | null>(null)

  useEffect(() => {
    if (activation) return
    const activate = (event: Event) => {
      const invocation = readAppDesignInvocation(event)
      setActivation(current => current ?? invocation)
    }
    window.addEventListener('toggle-command-palette', activate)
    return () => window.removeEventListener('toggle-command-palette', activate)
  }, [activation])

  if (!activation) return null

  return (
    <Suspense fallback={null}>
      <LazyCommandPalette initialOpen initialOrigin={activation.origin} initialDesignOrigin={activation.snapshot} onOpen={onOpen} returnFocusFallbackRef={returnFocusFallbackRef} onPin={onPin} onUnpin={onUnpin} />
    </Suspense>
  )
}
