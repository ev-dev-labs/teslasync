import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

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
 * Usage:
 * ```tsx
 * <KpiOverviewCard id="drives-overview" {...} />
 * <PageHeaderSticky targetId="drives-overview" ariaLabel="Drive history summary">
 *   🚗 Test Model Y · 📅 Last 30 days · ●All · 4 drives · avg 🅑
 * </PageHeaderSticky>
 * ```
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
  const { reduce } = useMotionPreference();

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
    const behavior = reduce ? 'auto' : 'smooth';
    if (scrollEl) {
      scrollEl.scrollTo({ top: 0, behavior });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
  }, [reduce]);

  if (!visible) return null;

  const innerClass = cn(
    'flex items-center gap-3 px-4 py-2',
    typography.size.xs,
  );

  const content = (
    <>
      <div className={cn('flex-1 min-w-0 flex flex-wrap items-center gap-3 whitespace-normal break-words text-start', typography.color.secondary)}>
        {children}
      </div>
      {scrollToTop && (
        <Icon icon={ArrowUp} size="sm" className={typography.color.muted} />
      )}
    </>
  );

  return (
    <div
      className={cn(
        'sticky z-40 -mx-4 border-b border-[var(--border-subtle)] bg-[var(--surface-1)]',
        className,
      )}
      style={{ top: topOffset }}
      role="region"
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {scrollToTop ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleScrollTop}
          className={cn(innerClass, 'h-auto w-full rounded-none text-start', typography.weight.regular)}
          aria-label={`${ariaLabel} — scroll to top`}
        >
          {content}
        </Button>
      ) : (
        <div className={innerClass}>{content}</div>
      )}
    </div>
  );
}
