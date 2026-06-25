// Native parity port of web/src/components/data-display/format/Duration.tsx.
// Renders a millisecond duration through the same four `formatDuration*`
// variants as the web helper. The web source imports those helpers from
// `@/lib/dateFormat`; the native parity surface has no equivalent module, so
// the pure (DOM-free) formatters are inlined verbatim here. The web `<span>`
// becomes an `AppText`, the `className` Tailwind hook is retained for source
// compatibility but ignored on native, and the raw-millisecond `title`
// tooltip is surfaced through `accessibilityHint`.

import React from 'react';
import { type StyleProp, type TextStyle } from 'react-native';

import { AppText } from '../../../../components/ui/AppText';

/** Universal placeholder returned by every formatter for unrenderable input. */
const FALLBACK = '—';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Millisecond duration as "250ms" or "1.5s". */
function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) return FALLBACK;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Millisecond duration with decimal minute rollover: "250ms", "1.5s", "2.5m". */
function formatDurationMsCompact(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) return FALLBACK;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/** Millisecond duration with minute/second output for longer jobs: "1m 05s". */
function formatDurationMsLong(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms <= 0) return FALLBACK;
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${formatRoundedInt(sec % 60)}s`;
}

/** Millisecond duration as a "m:ss" clock string: "2:05". */
function formatDurationClock(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms < 0) return FALLBACK;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export type DurationVariant = 'short' | 'long' | 'compact' | 'clock';

interface DurationProps {
  ms: number | null | undefined;
  variant?: DurationVariant;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Duration renderer that wraps the existing `formatDuration*` helpers and
 * exposes the raw millisecond value via `accessibilityHint` (the native analog
 * of the web `title` tooltip).
 */
export function Duration({
  ms,
  variant = 'short',
  className: _className,
  style,
  testID,
}: DurationProps) {
  if (ms == null || !Number.isFinite(ms)) {
    return (
      <AppText style={style} testID={testID}>
        {FALLBACK}
      </AppText>
    );
  }

  let display: string;
  switch (variant) {
    case 'long':
      display = formatDurationMsLong(ms);
      break;
    case 'compact':
      display = formatDurationMsCompact(ms);
      break;
    case 'clock':
      display = formatDurationClock(ms);
      break;
    case 'short':
    default:
      display = formatDurationMs(ms);
      break;
  }

  return (
    <AppText accessibilityHint={`${ms} ms`} style={style} testID={testID}>
      {display}
    </AppText>
  );
}
