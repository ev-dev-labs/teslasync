import { useEffect, useRef, type AnimationEvent, type MouseEvent } from 'react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/** Selection events only: route changes and restored state never start motion. */
export function useNavIconMotion() {
  const { reduce } = useMotionPreference()
  const root = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const clear = () => root.current?.querySelectorAll('.is-animating').forEach(target => target.classList.remove('is-animating'))
    if (reduce) clear()
    // CSS cancels an animation when the OS preference changes, so animationend
    // will not fire. Listen directly as well as honoring the app preference.
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const change = () => { if (media?.matches) clear() }
    media?.addEventListener?.('change', change)
    return () => media?.removeEventListener?.('change', change)
  }, [reduce])
  return {
    ref: (element: HTMLElement | null) => { root.current = element },
    'data-nav-reduced': reduce || undefined,
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (reduce || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const action = (event.target as Element).closest('[data-nav-action]')
      if (!action || !event.currentTarget.contains(action)) return
      const target = action.querySelector<HTMLElement>('[data-nav-motion]')
      if (!target) return
      target.classList.remove('is-animating')
      // Flush the old animation before replaying an already selected item.
      void getComputedStyle(target).animationName
      target.classList.add('is-animating')
    },
    onAnimationEnd(event: AnimationEvent<HTMLElement>) {
      const target = event.target
      if (target instanceof HTMLElement && target.matches('[data-nav-motion]')) target.classList.remove('is-animating')
    },
  }
}
