// Native parity port of
// web/src/features/notifications/components/BrowserPushChannelCard.tsx.
//
// Renders the "Browser push" notification-channel card that sits alongside the
// user-configurable channels in the Channels tab. The web original surfaces
// three states (unsupported / not-subscribed / subscribed) plus a per-device
// list so a stale phone or laptop can be revoked remotely.
//
// Browser push is, by definition, a browser-device affordance built on the DOM
// Notification API + PushManager + a service worker. None of those exist in a
// React Native runtime, so the on-device subscribe/unsubscribe lifecycle cannot
// be reproduced natively (contract rules 4, 5 & 7). The card is therefore ported
// to ALWAYS render its explicit "Unavailable" state for the on-device action,
// while keeping the genuinely-useful server-side parity intact: the per-device
// list and the remote "remove device" action are plain REST calls that work
// natively, so you can still revoke a stale browser registration from the app.
//
// Each web dependency is mapped as follows (documented here + in the sidecar):
//   - react `useMemo` (web L21) -> kept as-is (react is runtime-agnostic).
//   - react-i18next `useTranslation` (web L22, L36) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('webpush.*', 'English') call keeps its English default + translation-key
//     intent at each call site (matches the RecentActivity port precedent).
//   - lucide-react icons (web L23) -> the shared native SemanticIcon, decorative
//     (lucide SVG has no native renderer):
//       BellRing   -> 'notificationsActive'  (header + Enable action)
//       BellOff    -> 'notificationsMuted'   (Disable action)
//       Smartphone -> 'monitor'  (no phone glyph in the semantic set; a neutral
//                                 device marker is the closest parity)
//       Trash2     -> 'delete'   (remove device)
//       AlertCircle-> 'alertCircle' (unsupported notice)
//     SemanticIcon tones are fixed by intent, so the web header's cyan accent
//     degrades to the notification family's amber — the icon meaning is kept.
//   - @/components/ui Badge (web L25) -> the inline ParityBadge below, mapping
//     the web success/neutral/warning variants onto the native theme tokens.
//   - @/components/ui Button (web L25) -> inline Pressables (icon + label) since
//     the shared AppButton is label-only; preserves variant + accessibility.
//   - @/components/ui GlassPanel (web L25) -> the shared native GlassPanel.
//   - @/hooks/useWebPush (web L26) -> inlined useNativeWebPush(): a native-safe
//     shim with the same return shape that reports browser push permanently
//     unavailable (isSupported/isPushSupported/isSubscribed false, permission
//     'denied', no-op subscribe/unsubscribe) because RN has no DOM PushManager.
//   - @/api/hooks/usePush usePushSubscriptions / useUnsubscribePush /
//     usePushPublicKey (web L27) -> the already-ported native usePush hooks
//     (same REST contract: GET/DELETE /push/subscribe, GET /push/public-key).
//   - @/lib/dateFormat formatRelative (web L28) -> ported inline, verbatim
//     branches (just now / Xm / Xh / Xd / absolute date fallback).
//   - @/api/types PushSubscriptionRow (web L29) -> imported from the native
//     usePush port, which re-declares the same row shape.
//   - className prop (web L32) -> the native `style` prop forwarded to GlassPanel
//     (React Native has no className).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported -- only react, react-native
// primitives, the shared native GlassPanel / AppText / SemanticIcon / theme
// tokens, and the ported native usePush hooks.

import React, {useMemo} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  usePushPublicKey,
  usePushSubscriptions,
  useUnsubscribePush,
  type PushSubscriptionRow,
} from '../../../api/hooks/usePush';

// ── react-i18next useTranslation replacement (web L22, L36) ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/dateFormat formatRelative (ported inline, verbatim branches) ──
const FALLBACK = '—';

/** Date only: "Apr 4, 2026" — native-safe Intl, the >7d fallback of formatRelative. */
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Relative time: "just now", "5m ago", "2h ago", "3d ago", or absolute date. */
function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return FALLBACK;
  }
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(d);
}

// ── @/hooks/useWebPush native-safe replacement ──
// React Native has no DOM Notification API, PushManager, or service worker, so
// the browser subscribe/unsubscribe lifecycle cannot run. This shim mirrors the
// web hook's return shape but reports browser push permanently unavailable; the
// card consumes it exactly as the web component consumes useWebPush().
type NativeNotificationPermission = 'default' | 'denied' | 'granted';

interface NativeWebPush {
  isSupported: boolean;
  isPushSupported: boolean;
  isSubscribed: boolean;
  currentEndpoint: string | null;
  permission: NativeNotificationPermission;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<boolean>;
}

const NATIVE_WEB_PUSH_UNAVAILABLE = false;

async function nativePushNoop(): Promise<boolean> {
  // No browser PushManager to talk to; the on-device action is a no-op.
  return NATIVE_WEB_PUSH_UNAVAILABLE;
}

function useNativeWebPush(): NativeWebPush {
  return {
    isSupported: NATIVE_WEB_PUSH_UNAVAILABLE,
    isPushSupported: NATIVE_WEB_PUSH_UNAVAILABLE,
    isSubscribed: NATIVE_WEB_PUSH_UNAVAILABLE,
    currentEndpoint: null,
    permission: 'denied',
    subscribe: nativePushNoop,
    unsubscribe: nativePushNoop,
  };
}

// ── @/components/ui Badge replacement (web success/neutral/warning variants) ──
type BadgeVariant = 'success' | 'neutral' | 'warning';

function ParityBadge({variant, label}: {variant: BadgeVariant; label: string}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText
        variant="caption"
        weight="semibold"
        style={badgeTextStyles[variant]}>
        {label}
      </AppText>
    </View>
  );
}

interface BrowserPushChannelCardProps {
  /** Native parity for the web `className` prop — forwarded to GlassPanel. */
  style?: StyleProp<ViewStyle>;
}

export function BrowserPushChannelCard({style}: BrowserPushChannelCardProps) {
  const t = useNativeTranslation();
  const {
    isSupported: notifSupported,
    isPushSupported,
    isSubscribed,
    currentEndpoint,
    permission,
    subscribe,
    unsubscribe,
  } = useNativeWebPush();
  const {data: publicKey, isLoading: keyLoading} = usePushPublicKey();
  const {data: subs} = usePushSubscriptions();
  const unsubMut = useUnsubscribePush();

  const rows = useMemo<PushSubscriptionRow[]>(() => subs ?? [], [subs]);

  // Disabled-state reason — the card still renders so users can SEE that
  // browser push exists but is not currently available.
  const disabledReason = (() => {
    if (!notifSupported) {
      return t(
        'webpush.unsupported.notification',
        "This browser doesn't support notifications.",
      );
    }
    if (!isPushSupported && !keyLoading && publicKey === null) {
      return t(
        'webpush.unsupported.serverDisabled',
        'Browser push is not configured on this server. Ask your administrator to set the VAPID keys.',
      );
    }
    if (!isPushSupported) {
      return t(
        'webpush.unsupported.pushApi',
        "This browser doesn't support the Push API.",
      );
    }
    if (permission === 'denied') {
      return t(
        'webpush.unsupported.permissionDenied',
        'Notifications are blocked for this site. Re-enable them in your browser settings to use browser push.',
      );
    }
    return null;
  })();

  const isUnsupported = disabledReason !== null;

  const handleEnable = async () => {
    await subscribe();
  };

  const handleDisable = async () => {
    await unsubscribe();
  };

  const handleRemoveDevice = async (endpoint: string) => {
    await unsubMut.mutateAsync(endpoint);
  };

  return (
    <GlassPanel style={[styles.panel, style]}>
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <SemanticIcon name="notificationsActive" size="md" decorative />
            <View style={styles.headerText}>
              <AppText style={styles.title}>
                {t('webpush.title', 'Browser push')}
              </AppText>
              <AppText style={styles.subtitle}>
                {t(
                  'webpush.subtitle',
                  'Get OS-level notifications even when TeslaSync is closed.',
                )}
              </AppText>
            </View>
          </View>
          {!isUnsupported &&
            (isSubscribed ? (
              <ParityBadge
                variant="success"
                label={t('webpush.status.subscribed', 'Active on this device')}
              />
            ) : (
              <ParityBadge
                variant="neutral"
                label={t('webpush.status.notSubscribed', 'Not subscribed')}
              />
            ))}
          {isUnsupported && (
            <ParityBadge
              variant="warning"
              label={t('webpush.status.unsupported', 'Unavailable')}
            />
          )}
        </View>

        {isUnsupported ? (
          <View style={styles.unsupportedNotice}>
            <SemanticIcon
              name="alertCircle"
              size="sm"
              decorative
              style={styles.noticeIcon}
            />
            <AppText style={styles.noticeText}>{disabledReason}</AppText>
          </View>
        ) : (
          <View style={styles.actionRow}>
            {isSubscribed ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(
                  'webpush.disable',
                  'Disable on this device',
                )}
                onPress={handleDisable}
                style={({pressed}) => [
                  styles.actionButton,
                  styles.actionButtonSecondary,
                  pressed && styles.pressed,
                ]}>
                <SemanticIcon name="notificationsMuted" size="sm" decorative />
                <AppText style={styles.actionButtonLabel}>
                  {t('webpush.disable', 'Disable on this device')}
                </AppText>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('webpush.enable', 'Enable on this device')}
                onPress={handleEnable}
                style={({pressed}) => [
                  styles.actionButton,
                  styles.actionButtonPrimary,
                  pressed && styles.pressed,
                ]}>
                <SemanticIcon name="notificationsActive" size="sm" decorative />
                <AppText
                  style={[styles.actionButtonLabel, styles.actionButtonLabelPrimary]}>
                  {t('webpush.enable', 'Enable on this device')}
                </AppText>
              </Pressable>
            )}
            <AppText style={styles.iosNote}>
              {t(
                'webpush.iosNote',
                'iOS Safari requires version 16.4 or later, and you must add TeslaSync to your Home Screen.',
              )}
            </AppText>
          </View>
        )}

        {rows.length > 0 && (
          <View style={styles.devicesSection}>
            <AppText style={styles.devicesTitle}>
              {t('webpush.devices.title', 'Registered devices')}
            </AppText>
            <View style={styles.devicesList}>
              {rows.map(row => {
                const isThisDevice =
                  currentEndpoint !== null && currentEndpoint === row.endpoint;
                const ua =
                  row.user_agent ??
                  t('webpush.devices.unknownAgent', 'Unknown browser');
                const last = row.last_used_at
                  ? t('webpush.devices.lastUsed', 'Last used {{when}}').replace(
                      '{{when}}',
                      formatRelative(row.last_used_at),
                    )
                  : t('webpush.devices.neverUsed', 'Not yet used');
                return (
                  <View key={row.id} style={styles.deviceRow}>
                    <View style={styles.deviceLeft}>
                      <SemanticIcon
                        name="monitor"
                        size="sm"
                        decorative
                        style={styles.deviceIcon}
                      />
                      <View style={styles.deviceText}>
                        <AppText
                          numberOfLines={1}
                          accessibilityLabel={ua}
                          style={styles.deviceUa}>
                          {ua}
                          {isThisDevice && (
                            <AppText style={styles.thisDevice}>
                              {' '}
                              {t('webpush.devices.thisDevice', '(this device)')}
                            </AppText>
                          )}
                        </AppText>
                        <AppText style={styles.deviceLast}>{last}</AppText>
                      </View>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t(
                        'webpush.devices.remove',
                        'Remove this device',
                      )}
                      onPress={() => handleRemoveDevice(row.endpoint)}
                      style={({pressed}) => [
                        styles.removeButton,
                        pressed && styles.pressed,
                      ]}>
                      <SemanticIcon name="delete" size="sm" decorative />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
  },
  body: {
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  unsupportedNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
    padding: 12,
  },
  noticeIcon: {
    marginTop: 1,
  },
  noticeText: {
    flex: 1,
    color: colors.warning,
    fontSize: 12,
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  actionButtonPrimary: {
    backgroundColor: colors.accent,
  },
  actionButtonSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionButtonLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  actionButtonLabelPrimary: {
    color: colors.background,
  },
  pressed: {
    opacity: 0.82,
  },
  iosNote: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  devicesSection: {
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  devicesTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  devicesList: {
    gap: spacing.sm,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    padding: 10,
  },
  deviceLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  deviceIcon: {
    marginTop: 1,
  },
  deviceText: {
    flex: 1,
  },
  deviceUa: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  thisDevice: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
  },
  deviceLast: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  removeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
    borderRadius: 10,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  neutral: {
    color: colors.textSecondary,
  },
  warning: {
    color: colors.warning,
  },
});
