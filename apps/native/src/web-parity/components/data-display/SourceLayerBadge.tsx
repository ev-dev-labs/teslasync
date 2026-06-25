// Native parity port of web/src/components/data-display/SourceLayerBadge.tsx.
// Debugger-only badge identifying which layer of the live-state contract a
// signal value came from (L1 in-process Store, L2 Redis cache, signal_log
// replay, or a stale Redis-backed value). The web source pulls three modules
// that have no native parity surface — react-i18next `useTranslation`, the `cn`
// class merger, and the web `<Tooltip>` wrapper — so:
//   - react-i18next is absent from the native deps, so `useTranslation` is a
//     local fallback resolver returning the inline English string (the same
//     approach used by the other web-parity data-display ports). The i18n keys
//     (sourceLayer.*) are still referenced so intent is preserved.
//   - `cn` only merged Tailwind class names; `className` is retained on props
//     for source compatibility but ignored on native (RN has no className).
//   - The Tailwind tint classes / CSS theme vars become native color literals
//     (background/text/border), mirroring the FRESHNESS_COLORS pattern in the
//     DataFreshness port. Values are the exact emerald/blue/amber-500 tints and
//     the dark-theme --surface-2 / --text-secondary / --border-strong /
//     --border-subtle values from the web stylesheet.
//   - The web hover `<Tooltip content>` has no native analog, so the layer
//     description (plus optional age) is surfaced through `accessibilityHint`
//     (matching the Speed.tsx port's title→accessibilityHint mapping). The
//     hover-only affordance itself is unavailable on native (documented in the
//     sidecar).
// The web `<span>` becomes an `AppText` glyph inside a `View` chip; the
// `data-source` debugging attribute is preserved through `accessibilityValue`.

import React from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../../../components/ui/AppText';

export type SignalSource = 'l1' | 'l2' | 'log' | 'stale' | string;

export interface SourceLayerBadgeProps {
  source: SignalSource | null | undefined;
  /** Optional age-in-ms — when provided, surfaces in the tooltip. */
  ageMs?: number | null;
  /** Render the badge with the layer label spelled out instead of the glyph. */
  showLabel?: boolean;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
}

type TFunc = (key: string, fallback: string) => string;

// react-i18next has no native parity module; like the other data-display ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
function useTranslation(): { t: TFunc } {
  return { t: (_key, fallback) => fallback };
}

interface LayerStyle {
  /** Native background fill (web Tailwind `bg-*` tint). */
  bg: string;
  /** Native glyph color (web Tailwind `text-*`). */
  text: string;
  /** Native 1px border color (web Tailwind `border-*`). */
  border: string;
  label: string;
  descKey: string;
  descFallback: string;
}

const STYLE: Record<string, LayerStyle> = {
  l1: {
    bg: 'rgba(16, 185, 129, 0.15)', // bg-emerald-500/15
    text: '#a7f3d0', // text-emerald-200
    border: 'rgba(16, 185, 129, 0.3)', // border-emerald-500/30
    label: 'L1',
    descKey: 'sourceLayer.l1.desc',
    descFallback: 'Read from the in-process SignalStore (hot path, freshest).',
  },
  l2: {
    bg: 'rgba(59, 130, 246, 0.15)', // bg-blue-500/15
    text: '#bfdbfe', // text-blue-200
    border: 'rgba(59, 130, 246, 0.3)', // border-blue-500/30
    label: 'L2',
    descKey: 'sourceLayer.l2.desc',
    descFallback:
      'Read from Redis cross-pod cache (legacy entry; freshness unknown).',
  },
  log: {
    bg: '#151621', // var(--surface-2)
    text: '#9ca3af', // var(--text-secondary)
    border: 'rgba(255, 255, 255, 0.2)', // var(--border-strong)
    label: 'LOG',
    descKey: 'sourceLayer.log.desc',
    descFallback: 'Replayed from signal_log (durable history).',
  },
  stale: {
    bg: 'rgba(245, 158, 11, 0.15)', // bg-amber-500/15
    text: '#fde68a', // text-amber-200
    border: 'rgba(245, 158, 11, 0.3)', // border-amber-500/30
    label: 'STALE',
    descKey: 'sourceLayer.stale.desc',
    descFallback:
      'Redis-backed value older than the 2-minute freshness window.',
  },
  unknown: {
    bg: '#151621', // var(--surface-2)
    text: '#9ca3af', // var(--text-secondary)
    border: 'rgba(255, 255, 255, 0.06)', // var(--border-subtle)
    label: '—',
    descKey: 'sourceLayer.unknown.desc',
    descFallback: 'Source layer unknown.',
  },
};

function formatAge(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} h`;
  return `${(ms / 86_400_000).toFixed(1)} d`;
}

export function SourceLayerBadge({
  source,
  ageMs,
  showLabel,
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
}: SourceLayerBadgeProps) {
  const { t } = useTranslation();
  const key = (source ?? 'unknown').toLowerCase();
  const layer = STYLE[key] ?? STYLE.unknown;
  const ageText = formatAge(ageMs);
  const tooltip = ageText
    ? `${t(layer.descKey, layer.descFallback)} (${t(
        'sourceLayer.age',
        'age',
      )}: ${ageText})`
    : t(layer.descKey, layer.descFallback);

  return (
    <View
      accessibilityHint={tooltip}
      accessibilityLabel={layer.label}
      accessibilityRole="text"
      accessibilityValue={{ text: key }}
      accessible
      style={[
        styles.badge,
        showLabel ? styles.badgeWide : styles.badgeNarrow,
        { backgroundColor: layer.bg, borderColor: layer.border },
        style,
      ]}
      testID={testID ?? dataTestID ?? 'source-layer-badge'}>
      <AppText numberOfLines={1} style={[styles.label, { color: layer.text }]}>
        {layer.label}
      </AppText>
    </View>
  );
}

SourceLayerBadge.displayName = 'SourceLayerBadge';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 4,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeNarrow: {
    minWidth: 24,
  },
  badgeWide: {
    minWidth: 40,
  },
  label: {
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    fontSize: 10,
    letterSpacing: 0.6,
    lineHeight: 10,
    textTransform: 'uppercase',
  },
});
