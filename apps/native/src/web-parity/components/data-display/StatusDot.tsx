// Native parity port of web/src/components/data-display/StatusDot.tsx.
//
// A tiny colored dot for inline status indication (e.g. unread alert markers).
// Replaces the DOM <span>, the Tailwind utility classes (`inline-block h-2 w-2
// rounded-full` + the per-severity `dot` background), the `cn` class-merge
// helper, and the `@/lib/tokens` severity helpers with a React Native View, a
// literal-hex dot-color map, and an inlined `normalizeSeverity`.
//
// The web ARIA contract maps cleanly onto native accessibility props:
//   - role="img" + aria-label -> accessibilityRole="image" + accessibilityLabel
//     (only when a `label` is provided)
//   - aria-hidden             -> accessibilityElementsHidden /
//     importantForAccessibility (the default decorative case with no label)

import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

/**
 * Canonical UI severity union. The wire-level severities are
 * `info` | `warn` | `critical`; `success` is a UI-only success affordance.
 */
type Severity = 'info' | 'warn' | 'critical' | 'success';

export interface StatusDotProps {
  severity: string | null | undefined;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Optional accessible label describing the dot's meaning. */
  label?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

// h-2 w-2 -> 8dp; rounded-full -> half-size border radius.
const DOT_SIZE = 8;

// Tailwind `dot` tokens from web/src/lib/tokens.ts severityTokens, resolved to
// literal hex preserving visual intent: sky-400 / amber-400 / red-400 /
// emerald-400.
const DOT_COLOR: Record<Severity, string> = {
  info: '#38bdf8', // bg-sky-400
  warn: '#fbbf24', // bg-amber-400
  critical: '#f87171', // bg-red-400
  success: '#34d399', // bg-emerald-400
};

/**
 * Normalize the wire-level severity values that may sneak into the frontend.
 * Mirrors `normalizeSeverity` from web/src/lib/tokens.ts, including the legacy
 * `warning` / `error` / `fatal` / `ok` aliases.
 */
function normalizeSeverity(s: string | null | undefined): Severity {
  if (!s) {
    return 'info';
  }
  const v = s.toLowerCase();
  if (v === 'warning') {
    return 'warn';
  }
  if (v === 'error' || v === 'fatal') {
    return 'critical';
  }
  if (v === 'ok' || v === 'success') {
    return 'success';
  }
  if (v === 'info' || v === 'warn' || v === 'critical') {
    return v as Severity;
  }
  return 'info';
}

/** Tiny colored dot for inline status indication (e.g. unread alert markers). */
export function StatusDot({
  severity,
  className: _className,
  label,
  style,
  testID,
  'data-testid': dataTestID,
}: StatusDotProps) {
  const sev = normalizeSeverity(severity);
  const hasLabel = Boolean(label);

  return (
    <View
      accessibilityElementsHidden={hasLabel ? undefined : true}
      accessibilityLabel={hasLabel ? label : undefined}
      accessibilityRole={hasLabel ? 'image' : undefined}
      accessible={hasLabel ? true : undefined}
      importantForAccessibility={hasLabel ? 'yes' : 'no-hide-descendants'}
      pointerEvents="none"
      style={[styles.dot, {backgroundColor: DOT_COLOR[sev]}, style]}
      testID={testID ?? dataTestID ?? 'status-dot'}
    />
  );
}

StatusDot.displayName = 'StatusDot';

const styles = StyleSheet.create({
  dot: {
    borderRadius: DOT_SIZE / 2,
    flexShrink: 0,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
});
