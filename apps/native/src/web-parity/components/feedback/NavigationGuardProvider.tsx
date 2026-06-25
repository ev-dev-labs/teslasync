// Native parity port of web/src/components/feedback/NavigationGuardProvider.tsx.
//
// The provider owns the in-app "form is dirty" guard registry and exposes the
// `register` / `confirmIfDirty()` context contract consumed by guarded links,
// guarded nav-links, and `useGuardedNavigate`. That registry + the confirm
// dialog flow are vendor-agnostic and ported verbatim — only state names and
// the dedup-via-pendingPromiseRef behaviour are preserved exactly.
//
// Three web siblings are NOT in the native parity manifest, so native-safe
// equivalents are inlined here and documented:
//
//   - react-router-dom `useNavigate` / `useLocation` (web L2) + the browser
//     History API (`window.history.pushState`, the `popstate` event): React
//     Native has NO DOM History API and the web-parity tree has no in-app
//     router, so the URL roll-back + programmatic `navigate(-1)` replay the web
//     uses to intercept the browser Back/Forward buttons is STRUCTURALLY
//     UNAVAILABLE. The closest native analogue of "intercept the platform Back
//     affordance when there are unsaved changes" is Android's hardware Back
//     button, so the web `popstate` interception (web L142-178) is reimplemented
//     with `BackHandler` (`hardwareBackPress`): when any guard is dirty the Back
//     press is blocked and routed through the SAME confirm dialog + the SAME
//     `pendingPromiseRef` dedup. Because there is no host router to replay the
//     navigation on discard, the discard branch sets a skip flag so the NEXT
//     hardware Back press is allowed through (the web replays it automatically;
//     native needs a second press). On iOS/macOS/Windows there is no hardware
//     Back, so the listener is inert and the guard relies entirely on
//     `confirmIfDirty()` being awaited by guarded navigation affordances — the
//     same way the web hook path works. The web `lastLocationRef` /
//     `resyncUrl` state (web L89, L135-140) only existed to roll the DOM URL
//     back, so they are dropped on native.
//   - react-i18next `useTranslation` (web L3) -> inlined
//     `useNativeTranslationFallback()` returning the web fallback copy, with the
//     identical i18n keys preserved (forms.unsavedTitle / forms.unsavedWarning /
//     forms.discard / forms.keepEditing / confirm.silence.checkbox).
//   - `@/components/ui/ConfirmDialog` (web L4) -> inlined `NavigationConfirmDialog`,
//     a native-safe RN Modal port of the warning-variant subset the provider
//     actually uses (open/title/message/confirmLabel/cancelLabel/variant/
//     silenceKey). Its localStorage-backed "Don't ask again" silence (web
//     lib/confirmSilence) becomes an in-memory module store — the same
//     single-process native-safe degradation used by other web-parity ports;
//     the auto-resolve-when-silenced and reset-on-open behaviours are preserved.
//     The web Escape-key cancel (DOM keydown) maps to the Modal `onRequestClose`
//     + backdrop press; the HTML checkbox becomes an accessible Pressable toggle.
//
// The provider coexists, on web, with `useDirtyForm`'s `beforeunload` listener
// (tab close / reload / external links). React Native has no tab/reload lifecycle
// and no `beforeunload`, so that split of responsibilities collapses to this
// single in-app guard on native.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {BackHandler, Modal, Pressable, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// ---------------------------------------------------------------------------
// confirmSilence — native-safe in-memory port of web/src/lib/confirmSilence.ts.
//
// The web helper persists "Don't ask again" choices in localStorage so they
// survive reloads and sync across tabs. React Native has no localStorage and a
// single app instance, so the choice is held in a module-level Set for the
// lifetime of the process — the same single-process degradation used by other
// web-parity ports (e.g. the achievement celebration prefs).
// ---------------------------------------------------------------------------

const silencedActions = new Set<string>();

function isSilenced(key: string): boolean {
  return silencedActions.has(key);
}

function silence(key: string): void {
  silencedActions.add(key);
}

/**
 * One registered "form is dirty" guard.
 *
 * Created by `useNavigationGuard`; the entry's `isDirty` and `getMessage`
 * callbacks read from refs so the registration effect doesn't have to re-run
 * every render. The provider owns the `Map<id, GuardEntry>`.
 */
export interface NavigationGuardEntry {
  /** Stable per-mount id — typically `useId()` from the consumer hook. */
  id: string;
  /** Returns true when the consumer has unsaved edits. */
  isDirty: () => boolean;
  /**
   * Optional caller-localized prompt text shown in the confirm dialog when
   * THIS guard is the one blocking navigation. When omitted, the provider
   * falls back to the generic `forms.unsavedWarning` translation.
   */
  getMessage: () => string | undefined;
}

interface PendingConfirm {
  resolve: (ok: boolean) => void;
  message?: string;
}

interface NavigationGuardContextValue {
  /**
   * Register a dirty-state callback. Returns an unregister function — call it
   * from a `useEffect` cleanup.
   */
  register: (entry: NavigationGuardEntry) => () => void;
  /**
   * Resolve immediately to `true` if no guards are dirty; otherwise show the
   * confirm dialog and resolve to the user's choice (`true` = discard /
   * navigate; `false` = keep editing / cancel navigation).
   *
   * If a confirm is already in flight (e.g. a hardware-Back dialog is already
   * open and the user taps a guarded link), the existing promise is returned —
   * the same dialog answers both call sites instead of stacking.
   */
  confirmIfDirty: () => Promise<boolean>;
}

const Ctx = createContext<NavigationGuardContextValue | null>(null);

/**
 * Default no-op context used when no `<NavigationGuardProvider>` is mounted.
 * Lets guarded links / nav-links / `useNavigationGuard` render inside isolated
 * component tests without forcing the consumer to wrap every test in the full
 * provider tree. In production the provider is mounted at the app root, so the
 * real implementation always wins.
 */
const NOOP_CTX: NavigationGuardContextValue = {
  register: () => () => {},
  confirmIfDirty: () => Promise.resolve(true),
};

interface NavigationConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  /**
   * Stable action id that, when set, lets the user opt out of future prompts
   * via a "Don't ask again" toggle. The choice is held in the in-memory silence
   * store and short-circuits the dialog on subsequent calls — `onConfirm` fires
   * immediately and the dialog never renders. Ignored for `variant === 'danger'`.
   */
  silenceKey?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Native-safe port of the warning-variant subset of `@/components/ui/ConfirmDialog`.
 * Renders an RN Modal with a warning/danger-toned message panel, an optional
 * "Don't ask again" toggle, and explicit confirm/cancel actions.
 */
function NavigationConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  silenceKey,
  onConfirm,
  onCancel,
}: NavigationConfirmDialogProps): React.ReactElement | null {
  const t = useNativeTranslationFallback();
  const [dontAskAgain, setDontAskAgain] = useState(false);

  // Silencing is only honored for non-destructive prompts. Danger variant
  // always re-prompts regardless of caller.
  const silenceHonored = Boolean(silenceKey && variant !== 'danger');

  // Reset the "don't ask again" toggle each time the dialog reopens so a stale
  // value from a previous invocation can't pre-tick the silence toggle.
  useEffect(() => {
    if (open) {
      setDontAskAgain(false);
    }
  }, [open]);

  // Auto-resolve when the user previously silenced this action: fire the
  // confirm callback as soon as `open` flips true. The early `return null`
  // below prevents any flash of the dialog before the parent commits open=false.
  useEffect(() => {
    if (open && silenceHonored && silenceKey && isSilenced(silenceKey)) {
      onConfirm();
    }
  }, [open, silenceHonored, silenceKey, onConfirm]);

  const toggleDontAskAgain = useCallback(() => {
    setDontAskAgain(value => !value);
  }, []);

  // Persist the silence choice BEFORE bubbling up to the parent so the next
  // call sees the updated store value.
  const handleConfirmPress = useCallback(() => {
    if (silenceHonored && silenceKey && dontAskAgain) {
      silence(silenceKey);
    }
    onConfirm();
  }, [silenceHonored, silenceKey, dontAskAgain, onConfirm]);

  // Suppress the dialog entirely when silenced — the auto-resolve effect above
  // fires `onConfirm` on the next tick.
  if (open && silenceHonored && silenceKey && isSilenced(silenceKey)) {
    return null;
  }

  const checkboxLabel = t(
    'confirm.silence.checkbox',
    "Don't ask again for this action",
  );

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="navigation-guard-dialog">
          <AppText style={styles.title} variant="title" weight="bold">
            {title}
          </AppText>

          <View
            style={[
              styles.messageBox,
              variant === 'danger'
                ? styles.messageBoxDanger
                : styles.messageBoxWarning,
            ]}>
            <SemanticIcon
              decorative
              name={variant === 'danger' ? 'error' : 'warning'}
              size="sm"
              style={styles.messageIcon}
            />
            <AppText style={styles.message}>{message}</AppText>
          </View>

          {silenceHonored ? (
            <Pressable
              accessibilityLabel={checkboxLabel}
              accessibilityRole="checkbox"
              accessibilityState={{checked: dontAskAgain}}
              onPress={toggleDontAskAgain}
              style={styles.silenceRow}
              testID="navigation-guard-silence">
              <View
                style={[
                  styles.checkbox,
                  dontAskAgain && styles.checkboxChecked,
                ]}>
                {dontAskAgain ? (
                  <AppText style={styles.checkboxMark} weight="bold">
                    {'\u2713'}
                  </AppText>
                ) : null}
              </View>
              <AppText style={styles.silenceLabel} tone="secondary">
                {checkboxLabel}
              </AppText>
            </Pressable>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              accessibilityLabel={cancelLabel}
              accessibilityRole="button"
              onPress={onCancel}
              style={({pressed}) => [
                styles.button,
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
              testID="navigation-guard-cancel">
              <AppText style={styles.cancelText} weight="semibold">
                {cancelLabel}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              onPress={handleConfirmPress}
              style={({pressed}) => [
                styles.button,
                variant === 'danger'
                  ? styles.confirmDangerButton
                  : styles.confirmWarningButton,
                pressed && styles.pressed,
              ]}
              testID="navigation-guard-confirm">
              <AppText style={styles.confirmText} weight="semibold">
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
NavigationConfirmDialog.displayName = 'NavigationConfirmDialog';

/**
 * Provides in-app unsaved-changes guarding for the entire React tree.
 *
 * Mount it at the app root so every guarded link, nav-link, and hardware Back
 * press is covered. It exposes a `confirmIfDirty()` API used by guarded
 * navigation affordances and, on Android, intercepts the hardware Back button
 * via `BackHandler`. When any registered guard reports dirty, a confirm dialog
 * is shown; the user's choice resolves the awaited promise so the caller can
 * complete or abandon the navigation.
 *
 * See the file header for the browser-History interception that is structurally
 * unavailable on native and how `BackHandler` stands in for it.
 */
export function NavigationGuardProvider({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  const t = useNativeTranslationFallback();
  const guards = useRef<Map<string, NavigationGuardEntry>>(new Map());
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Re-use the in-flight confirm when both a hardware-Back press AND a guarded
  // link tap race: the second caller awaits the same dialog instead of orphaning.
  const pendingPromiseRef = useRef<Promise<boolean> | null>(null);
  // Set immediately before we allow our own Back replay so the resulting Back
  // press isn't intercepted again (preventing an infinite re-prompt loop).
  const skipNextBackRef = useRef(false);

  const register = useCallback((entry: NavigationGuardEntry) => {
    guards.current.set(entry.id, entry);
    return () => {
      guards.current.delete(entry.id);
    };
  }, []);

  const findDirty = useCallback((): NavigationGuardEntry | null => {
    for (const e of guards.current.values()) {
      if (e.isDirty()) {
        return e;
      }
    }
    return null;
  }, []);

  const confirmIfDirty = useCallback((): Promise<boolean> => {
    if (pendingPromiseRef.current) {
      return pendingPromiseRef.current;
    }
    const dirty = findDirty();
    if (!dirty) {
      return Promise.resolve(true);
    }
    const promise = new Promise<boolean>(resolve => {
      setPending({resolve, message: dirty.getMessage()});
    });
    pendingPromiseRef.current = promise;
    return promise;
  }, [findDirty]);

  // hardwareBackPress handler — native analogue of the web `popstate` handler.
  // Intercept the platform Back button when any guard is dirty, block it, and
  // defer to the confirm dialog. On discard, set the skip flag so the NEXT Back
  // press is allowed through (there is no host router to replay navigate(-1));
  // on keep-editing, do nothing (the Back press was already blocked).
  useEffect(() => {
    const handler = (): boolean => {
      if (skipNextBackRef.current) {
        skipNextBackRef.current = false;
        return false;
      }
      const dirty = findDirty();
      if (!dirty) {
        return false;
      }

      if (!pendingPromiseRef.current) {
        const message = dirty.getMessage();
        const promise = new Promise<boolean>(resolve => {
          setPending({
            resolve: ok => {
              if (ok) {
                skipNextBackRef.current = true;
              }
              resolve(ok);
            },
            message,
          });
        });
        pendingPromiseRef.current = promise;
      }
      return true;
    };
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handler,
    );
    return () => subscription.remove();
  }, [findDirty]);

  const ctxValue = useMemo<NavigationGuardContextValue>(
    () => ({register, confirmIfDirty}),
    [register, confirmIfDirty],
  );

  // pending is mirrored into a ref so handleConfirm/handleCancel can resolve the
  // awaited promise WITHOUT calling the resolve wrapper inside a setState
  // updater. The ref + plain setPending(null) lets the resolve side effect run
  // as a normal event-handler setState, batched safely with pending=null.
  const pendingRef = useRef<PendingConfirm | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const handleConfirm = useCallback(() => {
    const current = pendingRef.current;
    pendingRef.current = null;
    pendingPromiseRef.current = null;
    setPending(null);
    if (current) {
      current.resolve(true);
    }
  }, []);

  const handleCancel = useCallback(() => {
    const current = pendingRef.current;
    pendingRef.current = null;
    pendingPromiseRef.current = null;
    setPending(null);
    if (current) {
      current.resolve(false);
    }
  }, []);

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      <NavigationConfirmDialog
        cancelLabel={t('forms.keepEditing', 'Keep editing')}
        confirmLabel={t('forms.discard', 'Discard changes')}
        message={
          pending?.message ??
          t('forms.unsavedWarning', 'You have unsaved changes. Discard them?')
        }
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        open={pending != null}
        silenceKey="unsaved-navigation"
        title={t('forms.unsavedTitle', 'Unsaved changes')}
        variant="warning"
      />
    </Ctx.Provider>
  );
}

export function useNavigationGuardContext(): NavigationGuardContextValue {
  const ctx = useContext(Ctx);
  return ctx ?? NOOP_CTX;
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: spacing.lg,
  },
  cancelButton: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  cancelText: {
    color: colors.textPrimary,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxChecked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxMark: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 16,
  },
  confirmDangerButton: {
    backgroundColor: colors.danger,
  },
  confirmText: {
    color: colors.background,
  },
  confirmWarningButton: {
    backgroundColor: colors.warning,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 480,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  message: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  messageBox: {
    alignItems: 'flex-start',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  messageBoxDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  messageBoxWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  messageIcon: {
    marginTop: 1,
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
  silenceLabel: {
    flex: 1,
    fontSize: 13,
  },
  silenceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
  },
});
