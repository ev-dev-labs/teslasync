// Native parity port of web/src/features/settings/components/TeslaAccountSection.tsx.
//
// The web component (source L20-190) is the Settings → Tesla Account GlassPanel.
// It renders, top to bottom:
//   1. A header row: IconBox (color="blue") + Shield glyph, a title, and a
//      subtitle (source L94-102).
//   2. A connection-status chip (source L104-149): when authenticated AND not
//      locally flagged disconnected, a green check circle + "Connected" label,
//      an optional amber "Expires in Nd" pill (the 7-day soft-warning), and the
//      "Token expires <datetime>" line. Otherwise a red cross circle +
//      "Not connected"/"Disconnected" + an optional reconnect hint.
//   3. An action row (source L151-177): when unauthenticated, a single "Connect
//      Tesla Account" button; otherwise Refresh Token / Sync Vehicles /
//      Re-authorize / Disconnect.
//   4. A transient "Synced N vehicle(s)." success line (source L179-183).
//   5. The disconnect ConfirmDialog (source L185-187).
//
// State / behaviour preserved verbatim: pillDisconnected + the auth-event
// listener effect (source L32-42), the prevAuthRef recovery edge effect
// (source L46-55), handleLogin (source L57-61), handleDisconnect (source
// L63-76), and the expiringSoon IIFE incl. SEVEN_DAYS_MS (source L18,81-89).
//
// Native-safe translation of every browser-only dependency (also in the
// .parity.json sidecar):
//   - `@/api/hooks/useSettings` useAuthStatus/useAuthURL/useRefreshAuth/
//     useDisconnectAuth/useSyncVehicles (source L4-6): imported from the already
//     ported native parity hooks mirror (../../../api/hooks/useSettings); same
//     /auth/status, /auth/url, /auth/refresh, /auth/disconnect, /vehicles/sync
//     paths and response shapes.
//   - react-i18next `useTranslation('settings')` (source L1,21): the native app
//     has no i18next runtime, so this uses the established native-safe
//     `useNativeTranslationFallback` shim — t(key, default, params?) returns the
//     English default with {{token}} interpolation (the AIRestorePanel /
//     NotificationSettings precedent). Every key + default + the {{days}}/{{count}}
//     params + the 'settings' namespace intent are preserved.
//   - `@/components/ui` GlassPanel (source L7): the existing native primitive.
//     IconBox (source L7): the native parity port (color="blue", string glyph
//     auto-tinted). Button (source L7): no native port, so a minimal native-safe
//     ActionButton (primary/secondary/danger/accent variants, glyph, loading
//     spinner) is reproduced locally (the NotificationSettings Button precedent);
//     the web `loading`/`animate-spin` pending affordance becomes an
//     ActivityIndicator + disabled state. ConfirmDialog (source L7): the native
//     parity port, driven by a locally reproduced `useConfirm()` (the web hook is
//     pure React — only its isSilenced dependency is browser-touching, imported
//     from the ConfirmDialog parity which already reduced it to an in-memory set).
//   - `@/components/motion` FadeIn (source L8): no native port; a plain View
//     wrapper (delay ignored = reduced-motion final state), matching the sibling
//     FadeIn stand-ins.
//   - `@/components/feedback/Toast` useToast (source L9): no native Toast provider
//     yet, so a local useToast() bridges success(title)/error(title,message) to
//     React Native Alert.alert (the TeslaRegionPage / NotificationChannelsView
//     precedent).
//   - `@/hooks/useConfirm` useConfirm (source L10): reproduced locally (see
//     above) returning the same { confirm, dialogProps } contract.
//   - `@/lib/cn` cn (source L11): the only use is the refresh/sync `animate-spin`
//     toggle (source L158,164), which is meaningless on RN — pending is shown via
//     the ActionButton spinner instead, so cn() is dropped.
//   - `@/lib/dateFormat` formatDateTime (source L12): reproduced native-safe
//     (toLocaleString with the same year/month/day/hour/minute field set, "—"
//     for nullish/unparseable), matching the web contract.
//   - `@/lib/teslaAuthRecovery` notifyTeslaAuthRecovered (source L13): the web
//     impl dispatches a DOM `teslasync:tesla-auth-recovered` CustomEvent on
//     `document`; React Native has no DOM. It is reproduced as a module-level
//     in-memory event bus (subscribeTeslaAuthEvent + notifyTeslaAuthRecovered)
//     that mirrors the publish/subscribe contract. The component subscribes to
//     'expired' and 'recovered' exactly as the web listens for the two document
//     events (source L36-37). No native banner emits 'expired' yet, so the pill
//     only clears on a recovery edge — the explicit native-unavailable state,
//     documented in the sidecar.
//   - lucide-react Shield/ExternalLink/RefreshCw/Car/CheckCircle/XCircle/
//     AlertTriangle (source L14-16): RN has no lucide; rendered as decorative
//     AppText glyphs (the sibling-port convention).

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {IconBox} from '../../../components/ui/IconBox';
import {
  ConfirmDialog,
  isSilenced,
  type ConfirmDialogProps,
} from '../../../components/ui/ConfirmDialog';
import {Caption, PanelTitle} from '../../../components/ui/Typography';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useAuthStatus,
  useAuthURL,
  useDisconnectAuth,
  useRefreshAuth,
  useSyncVehicles,
} from '../../../api/hooks/useSettings';

// ── native translation fallback (native-safe port of react-i18next, source L1,21) ──
type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValue: string,
  params?: NativeTParams,
) => string;

function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue, params) =>
    interpolate(defaultValue, params),
  ).current;
}

// ── native-safe useToast (web @/components/feedback/Toast, source L9,22) ──
interface NativeToast {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

function useToast(): NativeToast {
  return useMemo<NativeToast>(
    () => ({
      success: (title, message) => Alert.alert(title, message),
      error: (title, message) => Alert.alert(title, message),
    }),
    [],
  );
}

// ── native-safe formatDateTime (web @/lib/dateFormat, source L12,125) ──
// Mirrors the web helper: "—" for a nullish / unparseable timestamp, else the
// local "Apr 4, 2026, 2:30 AM" rendering with the same field set.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── native-safe tesla auth-recovery event bus (web @/lib/teslaAuthRecovery,
//    source L13,36-37,52) ──
// The web module dispatches/consumes DOM CustomEvents on `document`. React
// Native has no DOM, so the publish/subscribe contract is reproduced as a
// module-level in-memory registry. notifyTeslaAuthRecovered() emits 'recovered'
// (called on the unauthenticated → authenticated edge, source L52); the
// component subscribes to 'expired' + 'recovered' (source L36-37). No native
// surface emits 'expired' yet — documented in the sidecar.
type TeslaAuthEvent = 'expired' | 'recovered';
type TeslaAuthHandler = () => void;

const teslaAuthListeners: Record<TeslaAuthEvent, Set<TeslaAuthHandler>> = {
  expired: new Set(),
  recovered: new Set(),
};

function subscribeTeslaAuthEvent(
  event: TeslaAuthEvent,
  handler: TeslaAuthHandler,
): () => void {
  teslaAuthListeners[event].add(handler);
  return () => {
    teslaAuthListeners[event].delete(handler);
  };
}

/**
 * Emits the 'recovered' event. Native analog of the web
 * notifyTeslaAuthRecovered() which dispatches a DOM CustomEvent. Exported so a
 * future native re-auth banner can hide itself + drain queued mutations on the
 * recovery edge, exactly as the web TeslaReauthBanner does.
 */
export function notifyTeslaAuthRecovered(): void {
  teslaAuthListeners.recovered.forEach(handler => handler());
}

// ── native FadeIn stand-in (web @/components/motion FadeIn, source L8,92) ──
function FadeIn({children}: {children: React.ReactNode}) {
  return <View>{children}</View>;
}

// ── native-safe useConfirm (web @/hooks/useConfirm, source L10,28) ──
// Pure-React logic ported verbatim; the only browser-touching dependency
// (isSilenced) comes from the ConfirmDialog parity (in-memory set). Returns the
// same { confirm, dialogProps } contract so the call site is unchanged.
interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  requireTypedConfirmation?: string;
  typedConfirmationLabel?: string;
  silenceKey?: string;
}

interface InternalConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

function useConfirm() {
  const [state, setState] = useState<InternalConfirmState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    if (
      opts.silenceKey &&
      opts.variant !== 'danger' &&
      !opts.requireTypedConfirmation &&
      isSilenced(opts.silenceKey)
    ) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>(resolve => {
      setState(prev => {
        if (prev) {
          prev.resolve(false);
        }
        return {...opts, resolve};
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState(current => {
      if (current) {
        current.resolve(true);
      }
      return null;
    });
  }, []);

  const handleCancel = useCallback(() => {
    setState(current => {
      if (current) {
        current.resolve(false);
      }
      return null;
    });
  }, []);

  const dialogProps: ConfirmDialogProps | null = state
    ? {
        open: true,
        title: state.title,
        message: state.message,
        confirmLabel: state.confirmLabel,
        cancelLabel: state.cancelLabel,
        variant: state.variant,
        requireTypedConfirmation: state.requireTypedConfirmation,
        typedConfirmationLabel: state.typedConfirmationLabel,
        silenceKey: state.silenceKey,
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      }
    : null;

  return {confirm, dialogProps};
}

// ── decorative glyphs (lucide-react icon stand-ins, source L14-16) ──
const SHIELD_GLYPH = '\uD83D\uDEE1'; // 🛡 Shield
const EXTERNAL_LINK_GLYPH = '\u2197'; // ↗ ExternalLink
const REFRESH_GLYPH = '\u21BB'; // ↻ RefreshCw
const CAR_GLYPH = '\uD83D\uDE97'; // 🚗 Car
const CHECK_GLYPH = '\u2714'; // ✔ CheckCircle
const CROSS_GLYPH = '\u2715'; // ✕ XCircle
const WARNING_GLYPH = '\u26A0'; // ⚠ AlertTriangle

// Resolved accents behind the web Tailwind classes. Toned-down 300-level text
// shades for body labels; neon hue at 10% alpha for the status circles.
const EMERALD_300 = '#6ee7b7'; // text-emerald-300 (source L112)
const ROSE_300 = '#fda4af'; // text-rose-300 (source L136)
const AMBER_300 = '#fcd34d'; // text-amber-300 (source L116)
const AMBER_SURFACE = 'rgba(245, 158, 11, 0.1)'; // bg-amber-500/10
const AMBER_BORDER = 'rgba(245, 158, 11, 0.3)'; // border-amber-500/30
const GREEN_CIRCLE = 'rgba(16, 185, 129, 0.1)'; // bg-neon-green/10 (source L107)
const RED_CIRCLE = 'rgba(239, 68, 68, 0.1)'; // bg-neon-red/10 (source L132)
const SURFACE_FAINT = 'rgba(255, 255, 255, 0.02)'; // bg-white/[0.02] (source L104)
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.08)'; // border-[var(--border-subtle)]
const ACCENT_BORDER = 'rgba(0, 240, 255, 0.3)'; // !border-neon-cyan/30 (source L169)
const ACCENT_TEXT = '#67e8f9'; // !text-neon-cyan -> cyan-300 (source L169)

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'accent';

const BUTTON_VARIANTS: Record<
  ButtonVariant,
  {bg: string; border: string; fg: string}
> = {
  primary: {bg: colors.accent, border: colors.accent, fg: colors.background},
  secondary: {
    bg: colors.surfaceRaised,
    border: colors.border,
    fg: colors.textPrimary,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    fg: colors.danger,
  },
  accent: {bg: 'transparent', border: ACCENT_BORDER, fg: ACCENT_TEXT},
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ── native Button stand-in (web @/components/ui Button, source L7,153-174) ──
function ActionButton({
  variant = 'primary',
  glyph,
  label,
  onPress,
  loading = false,
  disabled = false,
  testID,
}: {
  variant?: ButtonVariant;
  glyph?: string;
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const v = BUTTON_VARIANTS[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        {backgroundColor: v.bg, borderColor: v.border},
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : glyph ? (
        <AppText style={[styles.buttonGlyph, {color: v.fg}]}>{glyph}</AppText>
      ) : null}
      <AppText style={[styles.buttonLabel, {color: v.fg}]} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

export function TeslaAccountSection() {
  const t = useNativeTranslationFallback();
  const toast = useToast();
  const {data: auth} = useAuthStatus();
  const authUrlMut = useAuthURL();
  const refreshMut = useRefreshAuth();
  const disconnectMut = useDisconnectAuth();
  const syncMut = useSyncVehicles();
  const {confirm: confirmDisconnect, dialogProps: disconnectDialogProps} =
    useConfirm();

  // Mirror TeslaReauthBanner events so this page shows token-expired status
  // before the next failed API call.
  const [pillDisconnected, setPillDisconnected] = useState(false);
  useEffect(() => {
    const onExpired = () => setPillDisconnected(true);
    const onRecovered = () => setPillDisconnected(false);
    const offExpired = subscribeTeslaAuthEvent('expired', onExpired);
    const offRecovered = subscribeTeslaAuthEvent('recovered', onRecovered);
    return () => {
      offExpired();
      offRecovered();
    };
  }, []);

  // Fire recovery only on the unauthenticated → authenticated edge so queued
  // mutations can replay and the banner can hide once per recovery.
  const prevAuthRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!auth) {
      return;
    }
    const wasAuthed = prevAuthRef.current;
    const isAuthed = !!auth.authenticated;
    if (wasAuthed === false && isAuthed) {
      notifyTeslaAuthRecovered();
    }
    prevAuthRef.current = isAuthed;
  }, [auth]);

  function handleLogin() {
    authUrlMut.mutate(undefined, {
      onSuccess: data => {
        void Linking.openURL(data.auth_url);
      },
    });
  }

  async function handleDisconnect() {
    const ok = await confirmDisconnect({
      title: t('tesla.disconnectTitle', 'Disconnect Tesla Account?'),
      message: t(
        'tesla.disconnectConfirm',
        'Disconnect your Tesla account? You will need to re-authorize to use TeslaSync.',
      ),
      variant: 'danger',
      confirmLabel: t('tesla.disconnect', 'Disconnect'),
      cancelLabel: t('common.cancel', 'Cancel'),
    });
    if (!ok) {
      return;
    }
    disconnectMut.mutate(undefined, {
      onSuccess: () =>
        toast.success(t('toast.disconnected', 'Tesla account disconnected')),
      onError: (err: Error) =>
        toast.error(t('toast.disconnectFailed', 'Disconnect failed'), err.message),
    });
  }

  // Compute soft-warning state — token expires within 7 days but is still
  // technically valid. Surfaces a "Expires in Nd" pill before the silent-
  // failure cliff hits.
  const expiringSoon = (() => {
    if (!auth?.authenticated || !auth.expires_at) {
      return null;
    }
    const expiresAt = new Date(auth.expires_at).getTime();
    if (Number.isNaN(expiresAt)) {
      return null;
    }
    const remaining = expiresAt - Date.now();
    if (remaining <= 0 || remaining > SEVEN_DAYS_MS) {
      return null;
    }
    const days = Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
    return days;
  })();

  return (
    <FadeIn>
      <GlassPanel style={styles.card} testID="settings-tesla-account">
        <View style={styles.headerRow}>
          <IconBox color="blue">{SHIELD_GLYPH}</IconBox>
          <View style={styles.headerText}>
            <PanelTitle>{t('tesla.title', 'Tesla Account')}</PanelTitle>
            <Caption>
              {t(
                'tesla.subtitle',
                'Connect your Tesla account to sync vehicles and data',
              )}
            </Caption>
          </View>
        </View>

        <View style={styles.statusRow}>
          {auth?.authenticated && !pillDisconnected ? (
            <>
              <View style={[styles.statusCircle, styles.statusCircleGreen]}>
                <AppText style={[styles.statusGlyph, styles.statusGlyphGreen]}>
                  {CHECK_GLYPH}
                </AppText>
              </View>
              <View style={styles.statusBody}>
                <View style={styles.statusLabelRow}>
                  <AppText style={styles.statusLabelGreen} weight="semibold">
                    {t('tesla.connected', 'Connected')}
                  </AppText>
                  {expiringSoon !== null ? (
                    <View
                      style={styles.expiringPill}
                      testID="tesla-expiring-soon-pill">
                      <AppText style={styles.expiringPillGlyph}>
                        {WARNING_GLYPH}
                      </AppText>
                      <AppText style={styles.expiringPillText}>
                        {t('tesla.expiringSoon', 'Expires in {{days}}d', {
                          days: expiringSoon,
                        })}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                {auth.expires_at ? (
                  <AppText style={styles.metaText}>
                    {t('tesla.tokenExpires', 'Token expires')}{' '}
                    {formatDateTime(auth.expires_at)}
                  </AppText>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <View style={[styles.statusCircle, styles.statusCircleRed]}>
                <AppText style={[styles.statusGlyph, styles.statusGlyphRed]}>
                  {CROSS_GLYPH}
                </AppText>
              </View>
              <View style={styles.statusBody}>
                <AppText style={styles.statusLabelRose} weight="semibold">
                  {pillDisconnected
                    ? t('tesla.disconnected', 'Disconnected')
                    : t('tesla.notConnected', 'Not connected')}
                </AppText>
                {pillDisconnected ? (
                  <AppText style={styles.metaText}>
                    {t(
                      'tesla.reauth.body',
                      'Reconnect to resume live data and commands.',
                    )}
                  </AppText>
                ) : null}
              </View>
            </>
          )}
        </View>

        <View style={styles.actionsRow}>
          {!auth?.authenticated ? (
            <ActionButton
              glyph={EXTERNAL_LINK_GLYPH}
              label={t('tesla.connect', 'Connect Tesla Account')}
              loading={authUrlMut.isPending}
              onPress={handleLogin}
              testID="tesla-connect"
              variant="primary"
            />
          ) : (
            <>
              <ActionButton
                disabled={refreshMut.isPending}
                glyph={REFRESH_GLYPH}
                label={t('tesla.refreshToken', 'Refresh Token')}
                loading={refreshMut.isPending}
                onPress={() =>
                  refreshMut.mutate(undefined, {
                    onSuccess: () =>
                      toast.success(t('toast.tokenRefreshed', 'Token refreshed')),
                    onError: (err: Error) =>
                      toast.error(
                        t('toast.tokenRefreshFailed', 'Token refresh failed'),
                        err.message,
                      ),
                  })
                }
                testID="tesla-refresh"
                variant="secondary"
              />
              <ActionButton
                disabled={syncMut.isPending}
                glyph={CAR_GLYPH}
                label={t('tesla.syncVehicles', 'Sync Vehicles')}
                loading={syncMut.isPending}
                onPress={() =>
                  syncMut.mutate(undefined, {
                    onError: (err: Error) =>
                      toast.error(
                        t('toast.syncFailed', 'Vehicle sync failed'),
                        err.message,
                      ),
                  })
                }
                testID="tesla-sync"
                variant="secondary"
              />
              <ActionButton
                disabled={authUrlMut.isPending}
                glyph={EXTERNAL_LINK_GLYPH}
                label={t('tesla.reauthorize', 'Re-authorize')}
                onPress={handleLogin}
                testID="tesla-reauthorize"
                variant="accent"
              />
              <ActionButton
                disabled={disconnectMut.isPending}
                glyph={CROSS_GLYPH}
                label={t('tesla.disconnect', 'Disconnect')}
                onPress={handleDisconnect}
                testID="tesla-disconnect"
                variant="danger"
              />
            </>
          )}
        </View>

        {syncMut.isSuccess ? (
          <AppText style={styles.syncedText}>
            {t('tesla.synced', 'Synced {{count}} vehicle(s).', {
              count: syncMut.data?.synced ?? 0,
            })}
          </AppText>
        ) : null}
      </GlassPanel>
      {disconnectDialogProps ? (
        <ConfirmDialog {...disconnectDialogProps} loading={disconnectMut.isPending} />
      ) : null}
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonGlyph: {
    fontSize: 14,
  },
  buttonLabel: {
    fontSize: 14,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  card: {
    gap: 20,
    padding: 24,
  },
  expiringPill: {
    alignItems: 'center',
    backgroundColor: AMBER_SURFACE,
    borderColor: AMBER_BORDER,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  expiringPillGlyph: {
    color: AMBER_300,
    fontSize: 10,
  },
  expiringPillText: {
    color: AMBER_300,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  statusBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  statusCircle: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  statusCircleGreen: {
    backgroundColor: GREEN_CIRCLE,
  },
  statusCircleRed: {
    backgroundColor: RED_CIRCLE,
  },
  statusGlyph: {
    fontSize: 14,
  },
  statusGlyphGreen: {
    color: colors.success,
  },
  statusGlyphRed: {
    color: colors.danger,
  },
  statusLabelGreen: {
    color: EMERALD_300,
    fontSize: 14,
  },
  statusLabelRose: {
    color: ROSE_300,
    fontSize: 14,
  },
  statusLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusRow: {
    alignItems: 'center',
    backgroundColor: SURFACE_FAINT,
    borderColor: BORDER_SUBTLE,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  syncedText: {
    color: EMERALD_300,
    fontSize: 14,
  },
});
