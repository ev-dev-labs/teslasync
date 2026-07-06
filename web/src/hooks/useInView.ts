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

  // Callers routinely pass `threshold` as an inline array literal
  // (`useInView({ threshold: [0, 0.5, 1] })`). A fresh array reference on every
  // render would change the effect's dependency identity and tear down + rebuild
  // the observer each render — defeating the lazy-mount purpose of the hook and
  // thrashing IntersectionObserver. Key the effect on the serialized values so
  // it only re-subscribes when the thresholds genuinely change.
  const thresholdKey = Array.isArray(threshold)
    ? threshold.join(',')
    : String(threshold);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const node = ref.current;
    if (!node) return;
    if (seenRef.current && freezeOnceVisible) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // A spec-compliant observer always delivers at least one entry, but
        // polyfills and test fakes can fire with an empty batch. Reading
        // `entries[0].isIntersecting` on `undefined` would throw inside the
        // observer callback, where React cannot recover from it.
        const entry = entries[0];
        if (!entry) return;
        if (entry.isIntersecting) {
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
    // `threshold` is read fresh inside the effect but keyed via `thresholdKey`
    // so equal-valued inline arrays don't trigger needless re-subscription.
  }, [rootMargin, thresholdKey, root, freezeOnceVisible]);

  return { ref, inView };
}
