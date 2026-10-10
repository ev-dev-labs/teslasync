import { useEffect, useRef, useState } from 'react';

/** Observe the host, never window.innerWidth: drawers and nested panels share
 * the same rules. Zero means unmeasured, not a verified phone viewport. */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => setWidth(host.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}
