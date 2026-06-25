// Native parity port of web/src/components/data-display/AnimatedNumber.tsx.
// Preserves the source component's count-up state model and locale-aware number
// formatting while rendering with React Native text primitives.

import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

type FrameScheduler = (callback: (timestamp: number) => void) => number;
type FrameCanceller = (handle: number) => void;

export interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

const DEFAULT_LOCALE = 'en-US';

export function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const scheduler = getFrameScheduler();
    const canceller = getFrameCanceller();

    if (!scheduler) {
      setDisplay(value);
      return undefined;
    }

    const scheduleFrame = scheduler;
    let cancelled = false;
    const start = getNow();
    const from = 0;
    const to = value;
    const durationMs = Math.max(0, duration * 1000);

    function tick(now: number) {
      if (cancelled) {
        return;
      }

      const elapsed = now - start;
      const progress =
        durationMs > 0 ? Math.min(elapsed / durationMs, 1) : 1;
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        rafRef.current = scheduleFrame(tick);
      }
    }

    rafRef.current = scheduleFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null && canceller) {
        canceller(rafRef.current);
      }
      rafRef.current = null;
    };
  }, [value, duration]);

  const formattedValue = fmtNumber(display, decimals);
  const label = accessibilityLabel ?? `${prefix ?? ''}${formattedValue}${suffix ?? ''}`;

  return (
    <AppText
      accessibilityLabel={label}
      style={[styles.text, style]}
      testID={testID ?? dataTestID}>
      {prefix}
      {formattedValue}
      {suffix}
    </AppText>
  );
}

AnimatedNumber.displayName = 'AnimatedNumber';

function getFrameScheduler(): FrameScheduler | null {
  const scheduler = (
    globalThis as typeof globalThis & {requestAnimationFrame?: unknown}
  ).requestAnimationFrame;

  if (typeof scheduler !== 'function') {
    return null;
  }

  return callback => {
    return (scheduler as (frame: () => void) => number)(() => {
      callback(getNow());
    });
  };
}

function getFrameCanceller(): FrameCanceller | null {
  const canceller = (
    globalThis as typeof globalThis & {cancelAnimationFrame?: unknown}
  ).cancelAnimationFrame;

  return typeof canceller === 'function'
    ? (canceller as FrameCanceller)
    : null;
}

function getNow(): number {
  const performance = (
    globalThis as typeof globalThis & {
      performance?: {now?: unknown};
    }
  ).performance;

  return typeof performance?.now === 'function'
    ? (performance.now as () => number)()
    : Date.now();
}

function fmtNumber(value: unknown, decimals = 0, locale = DEFAULT_LOCALE): string {
  const safeValue = safeNumber(value);

  try {
    return safeValue.toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeValue.toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

const styles = StyleSheet.create({
  text: {
    fontVariant: ['tabular-nums'],
  },
});
