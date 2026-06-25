// Native parity port of web/src/components/layout/status-bar/ConnectionSegment.tsx.
//
// Footer status-bar segment that pings the backend `/healthz` endpoint (via the
// ported useApiHealth hook) and surfaces the current API connection health
// (latency + ok/degraded/offline/unknown). The web source rendered a
// react-router <Link to="/system-status"> wrapped in a shared web <Tooltip>,
// holding a small colored status dot, a lucide-react state icon
// (Activity/AlertTriangle/CircleSlash/HelpCircle), a short "API" label, and a
// latency/state tail, all colored per status and sized with Tailwind. Color is
// intentionally paired with a distinct icon shape so the state stays legible to
// users with color-vision differences.
//
// React Native has no react-router <Link>, no hover <Tooltip>, no lucide-react,
// and no Tailwind, so this port reproduces the same behaviour and visual intent
// with React Native Pressable/View/AppText primitives and the design tokens --
// no DOM, no react-router, no lucide-react, no recharts/leaflet, and no web UI
// components. The four lucide glyphs are mapped to widely-supported,
// per-state-distinct text glyphs (documented on CONNECTION_VARIANTS) that keep
// the color-vision-difference legibility intent. Navigation is surfaced as an
// `onNavigate` callback receiving CONNECTION_SEGMENT_ROUTE_ID (parity for
// `<Link to="/system-status">`). The web hover tooltip has no native analogue,
// so its content is exposed via `accessibilityHint` (mirroring how Avatar
// surfaces its tooltip label) and the web `aria-label` maps to
// `accessibilityLabel`; both unavailable browser capabilities are recorded on
// nativeConnectionSegmentCapabilities and documented in the sidecar.

import React, {useCallback} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useApiHealth, type ApiHealthStatus} from '../../../api/hooks/useApiHealth';

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * Web route the segment linked to via react-router (`<Link to="/system-status">`).
 * Exposed as the native route id so the shell (or a test) can wire
 * {@link ConnectionSegmentProps.onNavigate} to the equivalent navigation.
 */
export const CONNECTION_SEGMENT_ROUTE_ID = 'system-status';

/**
 * Records which browser capabilities the web file relied on that are unavailable
 * on native, so the unavailable state is explicit and programmatically
 * inspectable (parity-contract rule 7).
 */
export const nativeConnectionSegmentCapabilities = {
  // The web wrapper was a react-router <Link>; native has no react-router, so
  // navigation is surfaced through the `onNavigate` callback instead.
  reactRouterLinkAvailable: false,
  // The web wrapped the link in a shared <Tooltip> shown on hover; native has no
  // hover affordance, so the tooltip copy is exposed via `accessibilityHint`.
  hoverTooltipAvailable: false,
  tooltipExposedVia: 'accessibilityHint',
} as const;

interface VariantConfig {
  /**
   * Per-state text glyph standing in for the web lucide icon. Each shape is
   * distinct so the state stays legible independent of color (parity with the
   * web "color paired with an icon" intent):
   *   - ok       -> '✓' (Activity / healthy & active)
   *   - degraded -> '⚠' (AlertTriangle)
   *   - offline  -> '∅' (CircleSlash)
   *   - unknown  -> '?' (HelpCircle / connecting)
   */
  glyph: string;
  /** Foreground color for the glyph + short label (parity for the Tailwind text color). */
  text: string;
  /** Status dot fill (parity for the Tailwind dot background). */
  dot: string;
  /** Short label, e.g. "API". Shown to the right of the icon when not iconOnly. */
  short: string;
}

export interface ConnectionSegmentProps {
  /** When true, render only the dot + status glyph (hide the label + latency tail). */
  iconOnly?: boolean;
  /**
   * Navigation handler. Parity for the web `<Link to="/system-status">`; callers
   * should route to {@link CONNECTION_SEGMENT_ROUTE_ID}. Omitted -> the segment
   * is inert (still renders the live status), matching how the native shell may
   * not yet own a route table.
   */
  onNavigate?: (routeId: string) => void;
  /** Native style override for the segment container. */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testID?: string;
}

/**
 * The web component read `t` from react-i18next. Native parity has no i18n
 * runtime wired yet, so this returns the English fallback string, preserving the
 * i18n key/fallback intent.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * Footer status-bar API connection health segment.
 *
 * Pings the backend `/healthz` endpoint (via {@link useApiHealth}) and surfaces
 * the current API connection health (latency + ok/degraded/offline/unknown).
 * Color is paired with an icon so the state is also legible to users with
 * color-vision differences.
 */
export function ConnectionSegment({
  iconOnly = false,
  onNavigate,
  style,
  testID = 'status-bar-connection-segment',
}: ConnectionSegmentProps) {
  const t = useNativeTranslationFallback();
  const {status, latencyMs} = useApiHealth();

  const cfg: Record<ApiHealthStatus, VariantConfig> = {
    ok: {
      glyph: '✓',
      text: colors.success,
      dot: colors.success,
      short: t('statusBar.connection.short', 'API'),
    },
    degraded: {
      glyph: '⚠',
      text: colors.warning,
      dot: colors.warning,
      short: t('statusBar.connection.short', 'API'),
    },
    offline: {
      glyph: '∅',
      text: colors.danger,
      dot: colors.danger,
      short: t('statusBar.connection.short', 'API'),
    },
    unknown: {
      glyph: '?',
      text: colors.textMuted,
      dot: colors.surfaceRaised,
      short: t('statusBar.connection.short', 'API'),
    },
  };
  const v = cfg[status];

  const stateLabel: Record<ApiHealthStatus, string> = {
    ok: t('statusBar.connection.ok', 'Online'),
    degraded: t('statusBar.connection.degraded', 'Degraded'),
    offline: t('statusBar.connection.offline', 'Offline'),
    unknown: t('statusBar.connection.unknown', 'Connecting…'),
  };

  const latencyLabel = latencyMs != null ? `${latencyMs}ms` : '—';

  // Parity for the web hover <Tooltip>: "API connection · {state}[ · {latency}]".
  // Native has no hover tooltip, so this is exposed via accessibilityHint.
  const tooltip = `${t('statusBar.connection.tooltip', 'API connection')} · ${
    stateLabel[status]
  }${latencyMs != null && status !== 'offline' ? ` · ${latencyLabel}` : ''}`;

  const ariaLabel = `${t('statusBar.connection.aria', 'API connection status')}: ${
    stateLabel[status]
  }${latencyMs != null && status !== 'offline' ? ` (${latencyLabel})` : ''}`;

  return (
    <Pressable
      accessibilityHint={tooltip}
      accessibilityLabel={ariaLabel}
      accessibilityRole="link"
      accessible
      hitSlop={6}
      onPress={() => onNavigate?.(CONNECTION_SEGMENT_ROUTE_ID)}
      style={({pressed}) => [styles.segment, pressed && styles.segmentPressed, style]}
      testID={testID}>
      <View
        importantForAccessibility="no"
        pointerEvents="none"
        style={[styles.dot, {backgroundColor: v.dot}]}
      />
      <AppText
        importantForAccessibility="no"
        style={[styles.glyph, {color: v.text}]}>
        {v.glyph}
      </AppText>
      {!iconOnly ? (
        <>
          <AppText
            importantForAccessibility="no"
            style={[styles.short, {color: v.text}]}>
            {v.short}
          </AppText>
          {status !== 'offline' && status !== 'unknown' && latencyMs != null ? (
            <AppText importantForAccessibility="no" style={styles.tail}>
              · {latencyLabel}
            </AppText>
          ) : null}
          {status === 'offline' ? (
            <AppText importantForAccessibility="no" style={styles.tail}>
              · {stateLabel.offline}
            </AppText>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

ConnectionSegment.displayName = 'ConnectionSegment';

const styles = StyleSheet.create({
  dot: {
    borderRadius: 3,
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  glyph: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 14,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: spacing.xs + 2,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  segmentPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  short: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  tail: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
});

export default ConnectionSegment;
