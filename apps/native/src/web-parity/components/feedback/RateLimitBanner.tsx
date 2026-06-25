// Native parity port of web/src/components/feedback/RateLimitBanner.tsx.
//
// Rate-limit / upstream-breaker UX banner. The web source reacts to two
// document-level CustomEvents emitted by `resilientFetch`:
//   • teslasync:rate-limited  — fired on a 429; detail = { scope, retryAfterSec }.
//   • teslasync:upstream-down — fired on a 503 with code UPSTREAM_BREAKER_OPEN;
//                               detail = { upstream, retryAfterSec }.
// Both render the same banner shape with a live countdown; when it hits zero the
// "Retry now" button enables and clicking it invalidates every TanStack Query so
// pages refetch. The user can also dismiss the banner locally.
//
// React Native has no `document` and no DOM CustomEvent bus, so the browser-only
// `document.addEventListener('teslasync:rate-limited' | 'teslasync:upstream-down')`
// pair is replaced by an in-process, typed module-level emitter (the faithful
// native analog of the document bus). The native resilience layer drives the
// banner by calling the exported `emitRateLimited` / `emitUpstreamDown`
// functions when it observes a 429 / 503 UPSTREAM_BREAKER_OPEN — exactly mirroring
// the web `resilientFetch` dispatching the document CustomEvents. Every other
// browser-only piece is adapted (see the parity sidecar for the line-by-line map):
//   • <div role="alert" aria-live> -> <View accessibilityRole="alert"
//                                       accessibilityLiveRegion="polite">
//   • lucide <Clock> / <AlertCircle> -> amber "\u23F1" / "\u26A0" text glyphs
//                                       (native ships no SVG icon set)
//   • lucide <X> dismiss             -> a Pressable with the "\u2715" glyph
//   • shared <Button size="sm">      -> the native AppButton (primary variant)
//   • react-i18next t()              -> an inline English-default t() with the
//                                       same keys + {{n}} interpolation
//   • Tailwind amber/backdrop classes -> StyleSheet using the warning tokens
//                                        (backdrop-blur has no native analog)
//   • useQueryClient().invalidateQueries() is kept verbatim (TanStack Query ships
//                                        in the native app).
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useEffect, useRef, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQueryClient} from '@tanstack/react-query';

import {AppButton} from '../../../components/ui/AppButton';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/**
 * Native parity ships no react-i18next provider; return the English default with
 * react-i18next-style `{{name}}` interpolation applied from `params`.
 */
function t(
  _key: string,
  fallback: string,
  params?: Record<string, string | number>,
): string {
  if (!params) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

/* ------------------------------------------------------------------ */
/*  Native-safe event bus (replaces the document CustomEvent contract)  */
/* ------------------------------------------------------------------ */

/** Mirrors the web `teslasync:rate-limited` document event name. */
export const RATE_LIMITED_EVENT = 'teslasync:rate-limited';
/** Mirrors the web `teslasync:upstream-down` document event name. */
export const UPSTREAM_DOWN_EVENT = 'teslasync:upstream-down';

/** Detail payload for a 429 rate-limit event (web `resilientFetch` parity). */
export interface RateLimitedEventDetail {
  scope: string;
  retryAfterSec: number;
}

/** Detail payload for a 503 UPSTREAM_BREAKER_OPEN event (web parity). */
export interface UpstreamDownEventDetail {
  upstream: string;
  retryAfterSec: number;
}

type RateLimitedListener = (detail: RateLimitedEventDetail) => void;
type UpstreamDownListener = (detail: UpstreamDownEventDetail) => void;

const rateLimitedListeners = new Set<RateLimitedListener>();
const upstreamDownListeners = new Set<UpstreamDownListener>();

/**
 * Native analog of `document.dispatchEvent(new CustomEvent('teslasync:rate-limited', …))`.
 * The native resilience layer should call this when it observes a 429.
 */
export function emitRateLimited(detail: RateLimitedEventDetail): void {
  for (const listener of Array.from(rateLimitedListeners)) {
    listener(detail);
  }
}

/**
 * Native analog of `document.dispatchEvent(new CustomEvent('teslasync:upstream-down', …))`.
 * The native resilience layer should call this on a 503 with code UPSTREAM_BREAKER_OPEN.
 */
export function emitUpstreamDown(detail: UpstreamDownEventDetail): void {
  for (const listener of Array.from(upstreamDownListeners)) {
    listener(detail);
  }
}

function subscribeRateLimited(listener: RateLimitedListener): () => void {
  rateLimitedListeners.add(listener);
  return () => {
    rateLimitedListeners.delete(listener);
  };
}

function subscribeUpstreamDown(listener: UpstreamDownListener): () => void {
  upstreamDownListeners.add(listener);
  return () => {
    upstreamDownListeners.delete(listener);
  };
}

/** Test-only reset for the module-level event-bus listener sets. */
export function __resetRateLimitBannerForTests(): void {
  rateLimitedListeners.clear();
  upstreamDownListeners.clear();
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface State {
  kind: 'rate-limited' | 'upstream-down';
  scope?: string;
  upstream?: string;
  expiresAt: number;
}

export interface RateLimitBannerProps {
  /** Native composition hook replacing the web `className` / sticky positioning. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * RateLimitBanner — transient banner shown while the API is rate-limited (429)
 * or the Tesla upstream breaker is open (503 UPSTREAM_BREAKER_OPEN).
 *
 * Driven by the module-level {@link emitRateLimited} / {@link emitUpstreamDown}
 * emitters (the native analog of the web document CustomEvent bus). Shows a
 * one-second countdown; once it reaches zero the "Retry now" action enables and
 * invalidates every TanStack Query so pages refetch. Dismissing only clears the
 * local visibility — it does NOT clear the resilience layer's short-circuit
 * cache, which expires on its own when the Retry-After window elapses.
 */
export function RateLimitBanner({style, testID}: RateLimitBannerProps = {}) {
  const qc = useQueryClient();
  const [state, setState] = useState<State | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onLimited = (detail: RateLimitedEventDetail) => {
      if (!detail || typeof detail.retryAfterSec !== 'number') {
        return;
      }
      setState({
        kind: 'rate-limited',
        scope: detail.scope,
        expiresAt: Date.now() + Math.max(0, detail.retryAfterSec) * 1000,
      });
      setNow(Date.now());
    };
    const onUpstream = (detail: UpstreamDownEventDetail) => {
      if (!detail || typeof detail.retryAfterSec !== 'number') {
        return;
      }
      setState({
        kind: 'upstream-down',
        upstream: detail.upstream,
        expiresAt: Date.now() + Math.max(0, detail.retryAfterSec) * 1000,
      });
      setNow(Date.now());
    };
    const unsubscribeLimited = subscribeRateLimited(onLimited);
    const unsubscribeUpstream = subscribeUpstreamDown(onUpstream);
    return () => {
      unsubscribeLimited();
      unsubscribeUpstream();
    };
  }, []);

  // Tick once per second only while the banner is visible — no reason to
  // re-render every second when no countdown is in flight.
  useEffect(() => {
    if (!state) {
      return undefined;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [state]);

  if (!state) {
    return null;
  }

  const remaining = Math.max(0, Math.ceil((state.expiresAt - now) / 1000));
  const isRateLimit = state.kind === 'rate-limited';
  const iconGlyph = isRateLimit ? '\u23F1' : '\u26A0';

  const handleRetry = () => {
    setState(null);
    void qc.invalidateQueries();
  };

  const handleDismiss = () => {
    setState(null);
  };

  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.container, style]}
      testID={testID ?? 'rate-limit-banner'}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.iconWrap}>
        <AppText style={styles.iconGlyph}>{iconGlyph}</AppText>
      </View>
      <View style={styles.messageWrap}>
        <AppText style={styles.message} weight="semibold">
          {isRateLimit
            ? t('ratelimit.banner', 'Too many requests — pausing for {{n}}s', {
                n: remaining,
              })
            : t(
                'upstream.banner',
                'Tesla upstream unavailable — retry in {{n}}s',
                {n: remaining},
              )}
        </AppText>
      </View>
      <View style={styles.actions}>
        <View testID="rate-limit-banner-retry">
          <AppButton
            label={t('ratelimit.retry', 'Retry now')}
            onPress={handleRetry}
            disabled={remaining > 0}
            variant="primary"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss', 'Dismiss')}
          onPress={handleDismiss}
          testID="rate-limit-banner-dismiss"
          style={({pressed}) => [
            styles.dismissButton,
            pressed && styles.dismissPressed,
          ]}>
          <AppText style={styles.dismissGlyph}>{'\u2715'}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

RateLimitBanner.displayName = 'RateLimitBanner';

export default RateLimitBanner;

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.sm,
  },
  container: {
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderBottomColor: colors.warningBorder,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    zIndex: 50,
  },
  dismissButton: {
    borderRadius: 10,
    padding: 6,
  },
  dismissGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 16,
  },
  dismissPressed: {
    opacity: 0.6,
  },
  iconGlyph: {
    color: colors.warning,
    fontSize: 16,
    lineHeight: 20,
  },
  iconWrap: {
    backgroundColor: colors.warningSurface,
    borderRadius: 10,
    flexShrink: 0,
    padding: 6,
  },
  message: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  messageWrap: {
    flex: 1,
    minWidth: 0,
  },
});
