// Native parity port of web/src/components/feedback/SessionExpiringModal.tsx.
//
// Soft-blocking "your session is about to expire" warning that pops ~60s before
// the upstream ForwardAuth cookie expires, with a live 1Hz countdown and two
// affordances:
//   • "Stay signed in" → re-polls /auth/session via the session monitor's
//     refresh(); sliding-session proxies renew the cookie on every authenticated
//     request, so the GET is itself the renewal.
//   • "Sign out now" → hands the user back to sign-in (see navigateToReauth note).
// In open-mode installs (no auth provider) the monitor reports mode === 'open'
// and the component renders nothing, exactly like the web original. The
// hard-expired companion (SessionExpiredModal) owns the hasExpired branch, so we
// bail out when hasExpired to avoid two modals racing for the screen.
//
// Web -> native mapping notes (siblings NOT in the native parity manifest are
// inlined here as native-safe equivalents):
//
//   - react-i18next useTranslation (web L2) -> inlined useNativeTranslationFallback()
//     returning the web fallback copy and reproducing i18next {{name}} interpolation
//     (used by the L174 {{countdown}} body and the L202 {{count}} more-drafts line),
//     mirroring the EditConflictBanner / ImpersonationBanner pattern.
//   - Modal + Button (@/components/ui, web L3) -> the React Native built-in Modal
//     primitive (transparent fade overlay + backdrop Pressable, the established
//     NavigationGuardProvider pattern) and Pressable+AppText buttons (so the web
//     data-testid / disabled affordances survive as testID + accessibilityState).
//     The shared web Modal allows Esc + backdrop close mapped to "stay signed in";
//     here onRequestClose (Android Back) + the backdrop Pressable map to handleClose
//     which runs the same renewal poll.
//   - lucide-react Clock + AlertTriangle (web L4) -> the boxed amber Clock badge is
//     reproduced as a custom amber glyph badge (preserving the bg-amber-300/15 +
//     text-amber-300 visual intent, the same choice ImpersonationBanner made over a
//     tone-clashing SemanticIcon); the inline amber AlertTriangle becomes a decorative
//     SemanticIcon name="warning" (glyph 'W!', warning/amber tone).
//   - useSessionMonitor (@/hooks/useSessionMonitor, web L5) is NOT in the native
//     parity manifest, so its logic is ported inline: the same /auth/session
//     TanStack Query (near-expiry-tightened refetchInterval, 4-min staleTime,
//     focus refetch, single retry), the same pure deriveSessionState reducer
//     (open/unauthenticated/expires_at-vs-expires_in branches), and the same 1Hz
//     live-clock tick so the countdown animates between polls.
//   - navigateToReauth (@/lib/resilience, web L6): the web redirects the browser to
//     the IdP (saving the current URL under 'teslasync-return-url' first) with a
//     window.location.reload() fallback. On the react-native-web target a browser
//     location exists, so that reload fallback (the documented base-less path) is
//     mirrored best-effort; on true native (iOS/Android) there is no browser
//     location, so we reset the cached /auth/session query — the closest analogue
//     of "send the user back to sign-in" — documented in the sidecar.
//
// Unsaved-draft inventory (web readDraftSummaries over localStorage keys prefixed
// `teslasync:draft:v`): the parsing/sorting logic is ported verbatim behind a
// native-safe globalThis.localStorage accessor. On the web target it enumerates
// drafts exactly like the web; on native there is no localStorage (and no
// useFormDraft registry), so it returns [] and the drafts section never renders —
// there are no browser-persisted drafts to lose. The web `data-testid` debug
// attributes are preserved as React Native testIDs.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';
import {
  useQuery,
  useQueryClient,
  type Query,
  type QueryClient,
} from '@tanstack/react-query';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {request} from '../../api/client';
import type {SessionInfo} from '../../api/types';

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      // Mirror i18next `{{name}}` interpolation against the web fallback copy.
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// useSessionMonitor — native-safe inline port of web/src/hooks/useSessionMonitor.ts.
// Polls /auth/session and surfaces the derived countdown state the modal needs.
// ---------------------------------------------------------------------------

const SESSION_POLL_MS = 5 * 60 * 1000;
const SESSION_STALE_MS = 4 * 60 * 1000;
/** Polling cadence while expiry is < NEAR_EXPIRY_THRESHOLD_S away. */
const SESSION_POLL_NEAR_EXPIRY_MS = 30 * 1000;
/**
 * When the server-reported `expires_in` is under this many seconds the hook
 * tightens polling so the countdown stays in sync with the upstream cookie's
 * actual lifetime instead of a stale snapshot.
 */
const NEAR_EXPIRY_THRESHOLD_S = 5 * 60;
/** Window (in seconds) before expiry that the modal opens. */
const SESSION_EXPIRING_THRESHOLD_S = 60;

const sessionMonitorKey = ['auth', 'session'] as const;

interface SessionMonitorState {
  data: SessionInfo | null;
  mode: 'open' | 'session' | 'unknown';
  expiresInSeconds: number | null;
  isExpiringSoon: boolean;
  hasExpired: boolean;
  renewable: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

/** Pure reducer: derives the countdown state from a snapshot + the live clock. */
function deriveSessionState(
  data: SessionInfo | null,
  nowMs: number,
): Pick<
  SessionMonitorState,
  'mode' | 'expiresInSeconds' | 'isExpiringSoon' | 'hasExpired' | 'renewable'
> {
  if (!data) {
    return {
      mode: 'unknown',
      expiresInSeconds: null,
      isExpiringSoon: false,
      hasExpired: false,
      renewable: false,
    };
  }

  if (data.mode === 'open') {
    return {
      mode: 'open',
      expiresInSeconds: null,
      isExpiringSoon: false,
      hasExpired: false,
      renewable: false,
    };
  }

  if (!data.authenticated) {
    return {
      mode: 'session',
      expiresInSeconds: null,
      isExpiringSoon: false,
      hasExpired: true,
      renewable: false,
    };
  }

  // Compute remaining seconds against the LIVE clock from the server's RFC3339
  // expires_at — clock-skew-safe relative to a static expires_in snapshot.
  let expiresInSeconds: number | null = null;
  if (typeof data.expires_at === 'string' && data.expires_at) {
    const parsed = Date.parse(data.expires_at);
    if (Number.isFinite(parsed)) {
      expiresInSeconds = Math.floor((parsed - nowMs) / 1000);
    }
  }

  // Fallback to the server-computed snapshot when expires_at is missing or
  // unparseable. Static, but the parent re-renders every second so the
  // countdown still animates.
  if (expiresInSeconds === null && typeof data.expires_in === 'number') {
    expiresInSeconds = data.expires_in;
  }

  if (expiresInSeconds === null) {
    return {
      mode: 'session',
      expiresInSeconds: null,
      isExpiringSoon: false,
      hasExpired: false,
      renewable: data.renewable,
    };
  }

  return {
    mode: 'session',
    expiresInSeconds,
    isExpiringSoon:
      expiresInSeconds > 0 && expiresInSeconds < SESSION_EXPIRING_THRESHOLD_S,
    hasExpired: expiresInSeconds <= 0,
    renewable: data.renewable,
  };
}

function useSessionMonitor(): SessionMonitorState {
  const query = useQuery<SessionInfo>({
    queryKey: sessionMonitorKey,
    queryFn: ({signal}) => request<SessionInfo>('/auth/session', {signal}),
    // Tighten the poll when expiry is near so the countdown tracks the upstream
    // cookie within ~30s instead of up to 5min.
    refetchInterval: (q: Query<SessionInfo>) => {
      const data = q.state.data;
      if (!data || data.mode !== 'session' || !data.authenticated) {
        return SESSION_POLL_MS;
      }
      const remaining =
        typeof data.expires_in === 'number'
          ? data.expires_in
          : Number.POSITIVE_INFINITY;
      return remaining < NEAR_EXPIRY_THRESHOLD_S
        ? SESSION_POLL_NEAR_EXPIRY_MS
        : SESSION_POLL_MS;
    },
    refetchOnWindowFocus: true,
    staleTime: SESSION_STALE_MS,
    // The endpoint never 401s, so a failed retry indicates a deeper network
    // problem; one quick retry is enough.
    retry: 1,
  });

  // Tick the local clock once per second so the countdown animates smoothly
  // between server polls. The interval only runs while a session-mode response
  // is mounted — open mode + the "no data yet" branch don't need it.
  const [now, setNow] = useState(() => Date.now());
  const queryMode = query.data?.mode;
  const queryAuthenticated = query.data?.authenticated;
  useEffect(() => {
    if (queryMode !== 'session') {
      return;
    }
    if (!queryAuthenticated) {
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [queryMode, queryAuthenticated]);

  const derived = deriveSessionState(query.data ?? null, now);

  const refetch = query.refetch;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    data: query.data ?? null,
    mode: derived.mode,
    expiresInSeconds: derived.expiresInSeconds,
    isExpiringSoon: derived.isExpiringSoon,
    hasExpired: derived.hasExpired,
    renewable: derived.renewable,
    isLoading: query.isPending,
    refresh,
  };
}

// ---------------------------------------------------------------------------
// navigateToReauth — native-safe port of web/src/lib/resilience.ts.
// ---------------------------------------------------------------------------

const RETURN_URL_KEY = 'teslasync-return-url';

interface BrowserLocationLike {
  href?: string;
  reload?: () => void;
}

interface SessionStorageLike {
  setItem?: (key: string, value: string) => void;
}

/**
 * Hands the user back to sign-in. On the react-native-web target a browser
 * `location` exists, so the web base-less fallback (save current URL under
 * 'teslasync-return-url', then reload so the ForwardAuth proxy redirects to its
 * login page) is mirrored best-effort. On true native there is no browser
 * location to redirect, so the cached /auth/session snapshot is reset — the
 * closest native analogue of forcing the auth gate to re-evaluate.
 */
function navigateToReauth(queryClient?: QueryClient): void {
  const loc = (globalThis as {location?: BrowserLocationLike}).location;
  if (loc && typeof loc.reload === 'function') {
    try {
      const store = (globalThis as {sessionStorage?: SessionStorageLike})
        .sessionStorage;
      if (store?.setItem && typeof loc.href === 'string') {
        store.setItem(RETURN_URL_KEY, loc.href);
      }
    } catch {
      // private-mode / quota — best-effort only
    }
    loc.reload();
    return;
  }

  void queryClient?.resetQueries({queryKey: sessionMonitorKey});
}

// ---------------------------------------------------------------------------
// Unsaved-draft inventory — native-safe port of the web localStorage reader.
// ---------------------------------------------------------------------------

const DRAFT_KEY_PREFIX = 'teslasync:draft:v';

interface DraftSummary {
  /** Display label derived from the draft's storage key. */
  label: string;
  /** Last-saved timestamp when known; null when the envelope is unparseable. */
  savedAt: Date | null;
}

interface WebStorageLike {
  length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
}

/**
 * Reads the localStorage draft registry without throwing. On native there is no
 * localStorage (and no useFormDraft registry), so this returns [] and the drafts
 * section never renders; on the web target it enumerates drafts like the web.
 */
function readDraftSummaries(): DraftSummary[] {
  const storage = (globalThis as {localStorage?: WebStorageLike}).localStorage;
  if (!storage) {
    return [];
  }
  const out: DraftSummary[] = [];
  const total = (() => {
    try {
      return storage.length;
    } catch {
      return 0;
    }
  })();
  for (let i = 0; i < total; i += 1) {
    let key: string | null = null;
    try {
      key = storage.key(i);
    } catch {
      break;
    }
    if (key === null) {
      continue;
    }
    if (!key.startsWith(DRAFT_KEY_PREFIX)) {
      continue;
    }

    let savedAt: Date | null = null;
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as {savedAt?: unknown};
        if (
          typeof parsed?.savedAt === 'number' &&
          Number.isFinite(parsed.savedAt)
        ) {
          savedAt = new Date(parsed.savedAt);
        }
      }
    } catch {
      /* corrupt envelope — still surface the key so the user knows it exists */
    }

    // Strip the `teslasync:draft:vN:` prefix → readable form-key tail
    // e.g. "alertstudio:rule:42".
    const tail = key.replace(/^teslasync:draft:v\d+:/, '');
    out.push({label: tail, savedAt});
  }
  // Most-recent first when possible.
  out.sort((a, b) => {
    const aMs = a.savedAt ? a.savedAt.getTime() : 0;
    const bMs = b.savedAt ? b.savedAt.getTime() : 0;
    return bMs - aMs;
  });
  return out;
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) {
    return '0:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function SessionExpiringModal(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const queryClient = useQueryClient();
  const {mode, expiresInSeconds, isExpiringSoon, hasExpired, refresh} =
    useSessionMonitor();
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // The hard-expired modal owns the hasExpired branch — bail out here so two
  // modals don't race for the screen.
  const open = mode === 'session' && isExpiringSoon && !hasExpired;

  // Refresh the draft inventory each time the modal opens so a draft added
  // since the last open isn't omitted.
  useEffect(() => {
    if (!open) {
      return;
    }
    setDrafts(readDraftSummaries());
  }, [open]);

  const countdown = useMemo(
    () => formatCountdown(expiresInSeconds ?? 0),
    [expiresInSeconds],
  );

  const handleStay = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const handleSignOut = useCallback(() => {
    // Explicit IdP hand-off — see navigateToReauth note.
    navigateToReauth(queryClient);
  }, [queryClient]);

  // Esc / backdrop / Android-Back close maps to the "stay signed in" intent so
  // dismissing the dialog implicitly does the renewal poll.
  const handleClose = useCallback(() => {
    void handleStay();
  }, [handleStay]);

  const title = t(
    'session.expiring.title',
    'Your session is about to expire',
  );
  const visibleDrafts = drafts.slice(0, 5);

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={handleClose}
          style={styles.backdrop}
        />

        <View
          accessibilityLabel={title}
          accessibilityRole="alert"
          accessibilityViewIsModal
          accessible
          style={styles.dialog}
          testID="session-expiring-modal">
          <View style={styles.headerRow}>
            <View style={styles.clockBadge}>
              <AppText style={styles.clockGlyph} weight="bold">
                CK
              </AppText>
            </View>
            <View style={styles.headerText}>
              <AppText style={styles.title} weight="semibold">
                {title}
              </AppText>
              <AppText
                style={styles.body}
                testID="session-expiring-countdown">
                {t(
                  'session.expiring.body',
                  'You will be signed out in {{countdown}}.',
                  {countdown},
                )}
              </AppText>
            </View>
          </View>

          {drafts.length > 0 ? (
            <View style={styles.draftPanel}>
              <View style={styles.draftHeader}>
                <SemanticIcon
                  decorative
                  name="warning"
                  size="sm"
                  style={styles.draftIcon}
                />
                <AppText style={styles.draftHeaderText} weight="semibold">
                  {t('session.expiring.unsavedTitle', 'Unsaved drafts')}
                </AppText>
              </View>
              <AppText style={styles.draftBody}>
                {t(
                  'session.expiring.unsavedBody',
                  'Sign out will keep these drafts in your browser, but you must sign in again to finish them.',
                )}
              </AppText>
              <View style={styles.draftList} testID="session-expiring-drafts">
                {visibleDrafts.map(d => (
                  <AppText
                    key={d.label}
                    numberOfLines={1}
                    style={styles.draftItem}>
                    {`\u2022 ${d.label}`}
                  </AppText>
                ))}
                {drafts.length > 5 ? (
                  <AppText style={styles.draftMore}>
                    {t('session.expiring.moreDrafts', '+{{count}} more', {
                      count: drafts.length - 5,
                    })}
                  </AppText>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={handleSignOut}
              style={({pressed}) => [
                styles.button,
                styles.ghostButton,
                pressed && styles.pressed,
              ]}
              testID="session-expiring-signout">
              <AppText style={styles.ghostText} weight="semibold">
                {t('session.expiring.signOut', 'Sign out now')}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{disabled: refreshing}}
              disabled={refreshing}
              onPress={handleStay}
              style={({pressed}) => [
                styles.button,
                styles.primaryButton,
                pressed && !refreshing && styles.pressed,
                refreshing && styles.buttonDisabled,
              ]}
              testID="session-expiring-stay">
              <AppText style={styles.primaryText} weight="semibold">
                {refreshing
                  ? t('session.expiring.staying', 'Refreshing…')
                  : t('session.expiring.stay', 'Stay signed in')}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  clockBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(252, 211, 77, 0.15)',
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  clockGlyph: {
    color: colors.warning,
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 420,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  draftBody: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  draftHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  draftHeaderText: {
    color: colors.warning,
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 16,
    textTransform: 'uppercase',
  },
  draftIcon: {
    marginTop: 0,
  },
  draftItem: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
  },
  draftList: {
    gap: 2,
    marginTop: spacing.sm,
  },
  draftMore: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  draftPanel: {
    backgroundColor: 'rgba(252, 211, 77, 0.04)',
    borderColor: colors.warningBorder,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
  },
  ghostButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghostText: {
    color: colors.textPrimary,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryText: {
    color: colors.background,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
});

export default SessionExpiringModal;
