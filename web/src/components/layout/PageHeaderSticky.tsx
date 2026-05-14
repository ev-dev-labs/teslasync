import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PageHeaderStickyProps {
  /**
   * `id` of the element whose visibility controls the sticky bar. The bar
   * appears when the target scrolls out of view (above the viewport) and
   * hides again when the target scrolls back into view. Typically the
   * page-level overview card.
   */
  targetId: string;
  /** Content rendered inside the bar — usually a compressed summary. */
  children: ReactNode;
  /**
   * Optional click handler — when provided, the whole bar becomes a
   * "scroll-to-top" button with a small `↑` glyph. Defaults to true so
   * the bar is always navigable; pass `false` to disable.
   */
  scrollToTop?: boolean;
  /** Pixel offset from the top of the viewport. Default 0. */
  topOffset?: number;
  /**
   * `aria-label` for the sticky region. Localise per page.
   */
  ariaLabel: string;
  /** Test hook on the outer node. */
  testId?: string;
  className?: string;
}

/**
 * `PageHeaderSticky` — IntersectionObserver-driven sticky bar that
 * appears once the page hero scrolls out of view. Renders provided
 * content (typically a compressed summary) and optionally turns the
 * whole bar into a click-to-scroll-top affordance.
 *
 * Usage:
 * ```tsx
 * <KpiOverviewCard id="drives-overview" {...} />
 * <PageHeaderSticky targetId="drives-overview" ariaLabel="Drive history summary">
 *   🚗 Test Model Y · 📅 Last 30 days · ●All · 4 drives · avg 🅑
 * </PageHeaderSticky>
 * ```
 *
 * Hidden by default until the target element scrolls past the top of
 * the viewport — uses `IntersectionObserver` with a top rootMargin
 * matching `topOffset` so the bar appears *exactly* when the hero
 * leaves the viewport, not a moment earlier.
 */
export function PageHeaderSticky({
  targetId,
  children,
  scrollToTop = true,
  topOffset = 0,
  ariaLabel,
  testId,
  className,
}: PageHeaderStickyProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Only show the sticky bar when the target has scrolled ABOVE the
        // viewport (user has scrolled past it). Without this guard the bar
        // would also appear while the target is still BELOW the viewport
        // on first paint of long pages — a false positive.
        const scrolledPast = entry.boundingClientRect.top < 0;
        setVisible(!entry.isIntersecting && scrolledPast);
      },
      { rootMargin: `-${topOffset}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId, topOffset]);

  const handleScrollTop = useCallback(() => {
    // The app's primary scroll container is `<main id="main-content">`
    // (Layout.tsx), not `window`. `window.scrollY` is always 0 in that
    // layout, so calling `window.scrollTo` would be a no-op. Detect the
    // real scroll element and scroll it; fall back to window for tests
    // and pages rendered outside the standard layout.
    const scrollEl = document.getElementById('main-content');
    if (scrollEl) {
      scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  if (!visible) return null;

  const innerClass = cn(
    'flex items-center gap-3 px-4 py-2 text-xs',
    scrollToTop && 'cursor-pointer hover:text-cyan-200 transition-colors',
  );

  const content = (
    <>
      <div className="flex-1 min-w-0 flex items-center gap-3 text-[var(--text-secondary)] truncate">
        {children}
      </div>
      {scrollToTop && (
        <ArrowUp className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" aria-hidden />
      )}
    </>
  );

  return (
    <div
      className={cn(
        'sticky z-40 -mx-4 border-b border-white/[0.06] bg-[var(--bg-1)]/95 backdrop-blur',
        className,
      )}
      style={{ top: topOffset }}
      role="region"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {scrollToTop ? (
        <button
          type="button"
          onClick={handleScrollTop}
          className={cn(innerClass, 'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60')}
          aria-label={`${ariaLabel} — scroll to top`}
        >
          {content}
        </button>
      ) : (
        <div className={innerClass}>{content}</div>
      )}
    </div>
  );
}
