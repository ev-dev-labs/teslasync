// Native parity port of web/src/components/layout/status-bar/LiveTelemetrySegment.tsx.
//
// Web role: a denser, single-line footer status-bar twin of <LiveIndicator>. It
// reflects the SSE/MQTT pipeline freshness via useLiveConnection():
//   - connected    -> emerald, "Live · Xs ago"
//   - reconnecting -> amber spinner
//   - disconnected -> rose, "Offline"
//   - unknown      -> muted, "Idle"
// The whole row is wrapped in a hover <Tooltip> and is a <Link to="/signal-diff">
// into the live signal explorer.
//
// Web -> native mapping notes (see nativeLiveTelemetrySegmentCapabilities + sidecar):
//   - useLiveConnection() is an SSE/MQTT browser-transport hook with no React
//     Native equivalent in this isolated parity port, so `status` and
//     `lastMessageAt` are accepted as native-supplied props (defaulting to
//     'unknown' / null), mirroring the sibling LiveIndicator port. The native
//     transport shell wires them from its own connection state.
//   - The <Link to="/signal-diff"> becomes an onNavigate(href) Pressable with
//     accessibilityRole="link" (href defaults to '/signal-diff'), matching the
//     LayoutBreadcrumbs port.
//   - The hover <Tooltip content=...> has no native hover analogue, so its body
//     is preserved as the Pressable accessibilityHint — the same context stays
//     reachable to assistive tech.
//   - lucide Wifi / WifiOff / Loader2 become monochrome text glyphs and the
//     Loader2 `animate-spin` is static (RN has no CSS spin), as in the
//     LiveIndicator port. The standalone colored status dot stays a real View.
//   - react-i18next useTranslation becomes an inline English-fallback t() with
//     {{age}} interpolation, preserving the statusBar.live.* i18n keys/intent.
//   - Tailwind text-emerald/amber/rose-300 (text) + -400 (dot) + var(--text-muted)
//     / var(--surface-2) resolve to the same hex values the LiveIndicator port
//     uses; the className flex/hover utilities become StyleSheet styles + a
//     pressed-opacity state. cn() is dropped (no className on native).

import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';

/** Overall live-data pipeline health. Ported from web useLiveConnection. */
export type LiveConnectionStatus =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unknown';

/**
 * Native-safe capability flags. The web segment derives its state from the
 * SSE/MQTT useLiveConnection() hook and a hover Tooltip; neither browser
 * affordance is reachable from this isolated parity port, so the connection
 * state arrives as props and the tooltip body is surfaced via accessibilityHint.
 */
export const nativeLiveTelemetrySegmentCapabilities = {
  useLiveConnectionHookAvailable: false,
  hoverTooltipAvailable: false,
  cssSpinnerAnimationAvailable: false,
  shellSuppliedConnectionStateSupported: true,
} as const;

interface LiveTelemetrySegmentProps {
  iconOnly?: boolean;
  /** Native-supplied connection status; defaults to 'unknown'. */
  status?: LiveConnectionStatus;
  /** Native-supplied ISO timestamp of the last live message; defaults to null. */
  lastMessageAt?: string | null;
  /**
   * Called when the segment is pressed. Native-safe replacement for the web
   * <Link to="/signal-diff"> router navigation.
   */
  onNavigate?: (href: string) => void;
  /** Destination passed to onNavigate. Defaults to '/signal-diff'. */
  href?: string;
  /** Pass-through style for the row (replaces the web className hook). */
  style?: StyleProp<ViewStyle>;
  /** Pass-through test id for the row. */
  testID?: string;
}

interface VariantConfig {
  /** Monochrome glyph standing in for the lucide Wifi/WifiOff/Loader2 icon. */
  glyph: string;
  /** Foreground colour (Tailwind *-300 shade / muted). */
  text: string;
  /** Standalone status-dot colour (Tailwind *-400 shade / surface-2). */
  dot: string;
  /** Short label, e.g. "Live". */
  short: string;
  /** Web `animate-spin` flag; static on native (no CSS spin). */
  spin?: boolean;
}

/** Inline English-fallback translator with {{age}} interpolation. */
function t(
  _key: string,
  fallback: string,
  vars?: {age?: string},
): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name as keyof typeof vars];
    return value === undefined ? '' : String(value);
  });
}

/** Ported verbatim from web/src/components/layout/status-bar/LiveTelemetrySegment.tsx. */
function ageSecondsLabel(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  const sec = Math.floor(ms / 1_000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m`;
  }
  const hr = Math.floor(min / 60);
  return `${hr}h`;
}

export function LiveTelemetrySegment({
  iconOnly = false,
  status = 'unknown',
  lastMessageAt = null,
  onNavigate,
  href = '/signal-diff',
  style,
  testID,
}: LiveTelemetrySegmentProps) {
  const cfg: Record<LiveConnectionStatus, VariantConfig> = {
    connected: {
      glyph: '≋',
      text: '#6ee7b7',
      dot: '#34d399',
      short: t('statusBar.live.short', 'Live'),
    },
    reconnecting: {
      glyph: '↻',
      text: '#fcd34d',
      dot: '#fbbf24',
      short: t('statusBar.live.reconnecting', 'Reconnecting'),
      spin: true,
    },
    disconnected: {
      glyph: '⊘',
      text: '#fda4af',
      dot: '#fb7185',
      short: t('statusBar.live.offline', 'Offline'),
    },
    unknown: {
      glyph: '⊘',
      text: colors.textMuted,
      dot: colors.surfaceRaised,
      short: t('statusBar.live.unknown', 'Idle'),
    },
  };
  const v = cfg[status];

  const tooltipBody =
    status === 'connected'
      ? `${t('statusBar.live.tooltip', 'Live telemetry stream')} · ${t(
          'statusBar.live.lastMessage',
          'Last message {{age}} ago',
          {age: ageSecondsLabel(lastMessageAt)},
        )}`
      : `${t('statusBar.live.tooltip', 'Live telemetry stream')} · ${v.short}`;

  const ariaLabel = `${t('statusBar.live.aria', 'Live telemetry status')}: ${v.short}`;

  return (
    <Pressable
      accessibilityHint={tooltipBody}
      accessibilityLabel={ariaLabel}
      accessibilityRole="link"
      hitSlop={6}
      onPress={() => onNavigate?.(href)}
      style={({pressed}) => [styles.segment, pressed && styles.pressed, style]}
      testID={testID}>
      <View style={[styles.dot, {backgroundColor: v.dot}]} />
      <AppText style={[styles.icon, {color: v.text}]} variant="caption">
        {v.glyph}
      </AppText>
      {!iconOnly ? (
        <>
          <AppText style={[styles.short, {color: v.text}]} variant="caption">
            {v.short}
          </AppText>
          {status === 'connected' && lastMessageAt ? (
            <AppText style={styles.age} tone="muted" variant="caption">
              {`· ${ageSecondsLabel(lastMessageAt)}`}
            </AppText>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

export default LiveTelemetrySegment;

const styles = StyleSheet.create({
  age: {
    fontSize: 11,
    lineHeight: 11,
  },
  dot: {
    borderRadius: 3,
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  icon: {
    flexShrink: 0,
    fontSize: 12,
    lineHeight: 12,
  },
  pressed: {
    opacity: 0.7,
  },
  segment: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 4,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  short: {
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 11,
  },
});
