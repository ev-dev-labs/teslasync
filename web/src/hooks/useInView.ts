/**
 * useInView — boolean "is this element currently in the viewport?" hook
 * built on IntersectionObserver.
 *
 * Use cases:
 *   Lazy-mount expensive subtrees (charts, maps, iframes) only once
 *     they enter the viewport.
 *   Trigger animations on first scroll-in.
 *
 * Returns a ref to attach to the target element and a boolean. By default
 * the boolean stays `true` once the element has been seen at least once
 * (`freezeOnceVisible`); set `freezeOnceVisible: false` to flip back to
 * `false` when the element scrolls out of view.
 *
 * SSR-safe: when `IntersectionObserver` is undefined (SSR or jsdom
 * without the polyfill) the hook reports `true` immediately so callers
 * still render content.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';

export interface UseInViewOptions {
  /** IntersectionObserver `rootMargin`. Default `'200px'` (pre-mount slightly before scroll-in). */
  rootMargin?: string;
  /** IntersectionObserver `threshold`. Default `0`. */
  threshold?: number | number[];
  /** Optional scroll root. Defaults to the viewport. */
  root?: Element | null;
  /** Once visible, stay `true` even if the element scrolls back out. Default `true`. */
  freezeOnceVisible?: boolean;
}

export function useInView<T extends Element = HTMLDivElement>(
  options: UseInViewOptions = {},
): { ref: RefObject<T>; inView: boolean } {
  const {
    rootMargin = '200px',
    threshold = 0,
    root = null,
    freezeOnceVisible = true,
  } = options;

  const ref = useRef<T>(null);
  const [inView, setInView] = useState<boolean>(() => {
    return typeof IntersectionObserver === 'undefined';
  });
  const seenRef = useRef(false);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const node = ref.current;
    if (!node) return;
    if (seenRef.current && freezeOnceVisible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const isVisible = entry.isIntersecting;
        if (isVisible) {
          seenRef.current = true;
          setInView(true);
          if (freezeOnceVisible) observer.disconnect();
        } else if (!freezeOnceVisible) {
          setInView(false);
        }
      },
      { rootMargin, threshold, root },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, threshold, root, freezeOnceVisible]);

  return { ref, inView };
}
