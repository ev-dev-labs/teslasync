import { useEffect, useRef, type AnimationEvent, type MouseEvent } from 'react'
import { useMotionPreference } from '@/hooks/useMotionPreference'

/** Selection events only: route changes and restored state never start motion. */
export function useNavIconMotion() {
  const { reduce } = useMotionPreference()
  const root = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (reduce) root.current?.querySelectorAll('.is-animating').forEach(target => target.classList.remove('is-animating'))
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
