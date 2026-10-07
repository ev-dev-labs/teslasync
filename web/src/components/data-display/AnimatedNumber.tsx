import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { fmtNumber, safeNumber } from '@/lib/numberFormat';

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

/**
 * Client-only read of the OS "reduce motion" preference. Evaluated inside the
 * animation effect (never during render) so it is jsdom/SSR-safe and always
 * reflects the live `window`. Falls back to `false` (motion allowed) when
 * `matchMedia` is unavailable.
 */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  className,
}: AnimatedNumberProps) {
  // Sanitise once: NaN / Infinity / a runtime-undefined value must never enter
  // the easing math (it would spread NaN across every frame). safeNumber maps
  // any non-finite input to 0 — the same value fmtNumber would ultimately show.
  const target = safeNumber(value);

  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number>(0);
  // Latest committed display value, tracked in a ref so a value change animates
  // from where the previous animation ended instead of snapping back to 0.
  // Without this, live-polling counters (odometer, fleet stats) flashed to zero
  // and re-counted up on every refetch.
  const displayRef = useRef(0);

  useEffect(() => {
    const from = displayRef.current;
    const to = target;
    // Sanitise duration the same way as value: a NaN/Infinity duration would
    // otherwise poison durationMs and freeze the counter on a non-finite frame
    // (progress = elapsed / NaN → NaN, which never reaches 1 to complete).
    const durationMs = Math.max(0, safeNumber(duration)) * 1000;

    // Skip the tween and land on the value when animating is pointless or
    // unwanted: a non-positive or non-finite duration, no delta to cover, or a
    // user who has requested reduced motion.
    if (durationMs === 0 || from === to || prefersReducedMotion()) {
      displayRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      const next = progress >= 1 ? to : from + (to - from) * eased;
      displayRef.current = next;
      setDisplay(next);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return (
    <span className={cn('tabular-nums', className)}>
      {prefix}
      {fmtNumber(display, decimals)}
      {suffix}
    </span>
  );
}
