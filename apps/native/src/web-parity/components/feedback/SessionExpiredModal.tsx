// Native parity port of web/src/components/feedback/SessionExpiredModal.tsx.
//
// Hard-blocks the UI when the upstream ForwardAuth session has fully expired.
// The web component has two activation paths and one recovery action:
//   1. useSessionMonitor() reports `hasExpired === true` (the polling path —
//      server reports authenticated:false or expires_at has elapsed).
//   2. Any API call returns 401 — resilientFetch dispatches the DOM
//      `teslasync:session-expired` event for that "sat idle between polls"
//      branch.
//   Recovery: "Sign in again" hands off to navigateToReauth() which points the
//   top-level window at the IdP entry point. Open mode (no auth provider) renders
//   nothing, and the modal is non-dismissible (Esc + backdrop are absorbed).
//
// Every browser-only dependency is reduced to an explicit native-safe analog and
// documented in the .parity.json sidecar:
//   - @/hooks/useSessionMonitor (TanStack Query poll of /auth/session): not yet
//     ported to native, so a native-safe SessionMonitorContext is defined here
//     with a safe default ({ mode: 'unknown', hasExpired: false }) so the modal
//     stays hidden until a host SessionMonitorProvider — or the `mode`/`hasExpired`
//     props — supply real state. The `/auth/session` path, `mode` ('open' short
//     circuit) and `hasExpired` state names are preserved on the contract.
//   - document.addEventListener(SESSION_EXPIRED_EVENT): React Native has no
//     `document`, so the DOM CustomEvent bus is replaced by a module-level
//     subscribe/emit registry (subscribeSessionExpired / emitSessionExpired). The
//     native api error handler can call emitSessionExpired() on a 401 exactly as
//     resilientFetch dispatches the DOM event; the SESSION_EXPIRED_EVENT constant
//     is preserved verbatim as the canonical event name.
//   - @/lib/resilience navigateToReauth() (window.location + sessionStorage):
//     neither exists on native, so the IdP handoff is delegated to an optional
//     `onReauth` bridge prop wired up by the native auth shell. Absent => explicit
//     no-op (documented unavailable state).
//   - @/components/ui Modal + Button: React Native's <Modal> (transparent, fade,
//     non-dismissible onRequestClose no-op) + a Pressable primary button styled
//     from the design tokens.
//   - lucide-react Lock: rendered as a decorative AppText padlock glyph inside a
//     rose alert chip (importantForAccessibility="no", mirroring the web
//     aria-hidden). The web rose-300 line-icon tint maps to the danger token ramp.

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTFunction = (key: string, defaultValue: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue) => defaultValue).current;
}

// ── session monitor bridge (native-safe port of @/hooks/useSessionMonitor) ──
/** Resolved deployment mode; 'open' means "session timeout doesn't apply". */
export type SessionMode = 'open' | 'session' | 'unknown';

/**
 * The slice of the web SessionMonitorState that the modal consumes. The web hook
 * polls `/auth/session` and derives the full state; on native a host wires real
 * values through {@link SessionMonitorContext} (or the modal props).
 */
export interface SessionMonitorState {
  mode: SessionMode;
  hasExpired: boolean;
}

const DEFAULT_SESSION_MONITOR: SessionMonitorState = {
  mode: 'unknown',
  hasExpired: false,
};

/**
 * Exported so a native auth shell can supply real session state (the analog of
 * the web useSessionMonitor poll). Defaults to a safe "no session to expire"
 * value so the modal stays hidden — and tests render — without a provider.
 */
export const SessionMonitorContext = createContext<SessionMonitorState>(
  DEFAULT_SESSION_MONITOR,
);

export function useSessionMonitor(): SessionMonitorState {
  return useContext(SessionMonitorContext);
}

// ── session-expired event bridge (native-safe port of the DOM CustomEvent) ──
/** Preserved verbatim from the web file as the canonical event name. */
export const SESSION_EXPIRED_EVENT = 'teslasync:session-expired';

type SessionExpiredListener = () => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

/**
 * Native analog of `document.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))`.
 * The native api error handler calls this on a hard 401, exactly as the web
 * resilientFetch dispatches the DOM event for the "idle between polls" branch.
 */
export function emitSessionExpired(): void {
  for (const listener of [...sessionExpiredListeners]) {
    listener();
  }
}

/** Native analog of `document.addEventListener`; returns the unsubscribe fn. */
export function subscribeSessionExpired(
  listener: SessionExpiredListener,
): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

export interface SessionExpiredModalProps {
  /** Override the monitor mode; falls back to {@link SessionMonitorContext}. */
  mode?: SessionMode;
  /** Override the expired flag; falls back to {@link SessionMonitorContext}. */
  hasExpired?: boolean;
  /**
   * Native reauth bridge replacing the web navigateToReauth(). React Native has
   * no window.location / sessionStorage, so the host wires the platform sign-in
   * flow here. Absent => intentional no-op (documented unavailable state).
   */
  onReauth?: () => void;
}

/**
 * Hard-blocks the UI when the upstream ForwardAuth session has fully expired.
 * Renders nothing in open mode; non-dismissible — the only way out is the
 * "Sign in again" button which calls the {@link SessionExpiredModalProps.onReauth}
 * bridge.
 */
export function SessionExpiredModal({
  mode: modeProp,
  hasExpired: hasExpiredProp,
  onReauth,
}: SessionExpiredModalProps) {
  const t = useNativeTranslationFallback();
  const monitor = useSessionMonitor();
  const mode = modeProp ?? monitor.mode;
  const hasExpired = hasExpiredProp ?? monitor.hasExpired;
  const [eventTriggered, setEventTriggered] = useState(false);

  useEffect(() => {
    // Native event bridge instead of document.addEventListener — subscribe
    // returns its own removeListener for the cleanup phase.
    const handler = () => setEventTriggered(true);
    return subscribeSessionExpired(handler);
  }, []);

  // Suppress entirely in open mode — there is no session to expire.
  if (mode === 'open') {
    return null;
  }

  const open = hasExpired || eventTriggered;

  const handleSignIn = () => {
    // Explicit IdP handoff bridge. The web navigateToReauth() writes the current
    // URL to sessionStorage and points window.location at the IdP; neither exists
    // on native, so the host-supplied onReauth performs the platform sign-in.
    // No bridge => intentional no-op.
    if (onReauth) {
      onReauth();
    }
  };

  return (
    <Modal
      animationType="fade"
      // Non-dismissible: the Android back button / system close request is
      // absorbed by a no-op so the user MUST take the explicit "Sign in again"
      // action — mirrors the web Modal no-op onClose for Esc + backdrop.
      onRequestClose={() => {
        /* intentional no-op — hard block until re-auth */
      }}
      transparent
      visible={open}>
      {/* Backdrop has no press handler, so taps cannot dismiss — the native
          equivalent of the web modal absorbing backdrop clicks. */}
      <View style={styles.backdrop}>
        <View
          accessibilityLabel={t('session.expired.title', 'Session expired')}
          accessibilityViewIsModal
          accessible
          style={styles.dialog}
          testID="session-expired-modal">
          <View style={styles.content}>
            <View style={styles.iconChip}>
              <AppText
                importantForAccessibility="no"
                style={styles.iconGlyph}>
                {'\uD83D\uDD12'}
              </AppText>
            </View>
            <View style={styles.textGroup}>
              <AppText style={styles.title} weight="semibold">
                {t('session.expired.title', 'Session expired')}
              </AppText>
              <AppText style={styles.body} tone="secondary">
                {t(
                  'session.expired.body',
                  'For your security, your session has timed out. Sign in again to pick up where you left off.',
                )}
              </AppText>
            </View>
            <Pressable
              accessibilityLabel={t('session.expired.signIn', 'Sign in again')}
              accessibilityRole="button"
              onPress={handleSignIn}
              style={({pressed}) => [
                styles.signInButton,
                pressed && styles.signInPressed,
              ]}
              testID="session-expired-signin">
              <AppText style={styles.signInText} weight="semibold">
                {t('session.expired.signIn', 'Sign in again')}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 4, 10, 0.72)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  dialog: {
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 360,
    padding: spacing.xl,
    width: '100%',
  },
  content: {
    alignItems: 'center',
    gap: 16,
  },
  iconChip: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  iconGlyph: {
    color: colors.danger,
    fontSize: 24,
    lineHeight: 28,
  },
  textGroup: {
    width: '100%',
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    textAlign: 'center',
  },
  signInButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    width: '100%',
  },
  signInPressed: {
    opacity: 0.82,
  },
  signInText: {
    color: colors.background,
  },
});

export default SessionExpiredModal;
