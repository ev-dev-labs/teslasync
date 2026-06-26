// Native parity port of web/src/hooks/useConfirm.ts.
//
// The web module is a pure, UI-agnostic React hook: a promise-based
// confirmation state machine built on useState/useCallback. Its own body
// contains no JSX, no DOM element, no Recharts/Leaflet, and no browser-only
// API — the hook just stores the pending request, constructs a
// ConfirmDialogProps object, and resolves a Promise<boolean>. Hermes runs the
// same useState/useCallback/Promise primitives, so the state machine ports 1:1
// to React Native.
//
// Two web imports are not yet ported, so — following the established parity
// convention (useActiveFilterChips inlines FilterChipDescriptor;
// useOnboardingSkip substitutes a native-safe localStorage shim) — both are
// inlined here with the minimal surface useConfirm consumes:
//
//   * `ConfirmDialogProps` (type-only) from `@/components/ui/ConfirmDialog`:
//     the web ui/ConfirmDialog component is not yet ported, so its prop
//     interface is declared module-locally and re-exported, keeping the
//     `dialogProps` return contract structurally identical to web. The hook
//     controls open/onConfirm/onCancel and leaves `loading` to the dialog,
//     exactly as on web.
//   * `isSilenced` from `@/lib/confirmSilence`: the web lib reads a JSON array
//     of silenced action ids from browser localStorage. React Native has no
//     localStorage, so only the read path useConfirm needs is reproduced with a
//     WebStorageLike shim that prefers globalThis.localStorage when present
//     (react-native-web target, preserving the exact STORAGE_KEY
//     'teslasync:confirm-silence:v1' and the JSON-array schema so it
//     interoperates with the future confirmSilence native port) and otherwise
//     returns an empty set. Durable cross-restart persistence on a pure native
//     runtime is intentionally unavailable (see nativeConfirmSilenceCapabilities
//     + the parity sidecar); the safe default is that the dialog re-prompts,
//     mirroring the web "worst case the dialog re-prompts next time" contract.
//
// State name (state), the confirm/handleConfirm/handleCancel surface, the
// silence short-circuit safety gate (never silence destructive / typed-
// confirmation flows even when a silenceKey is passed), the rapid
// double-trigger resolve-as-cancel guard, and the full dialogProps shape are
// all preserved exactly as on web.

import {useCallback, useState} from 'react';

/* ── Inlined ConfirmDialogProps ───────────────────────────────
 * Mirrors the web `ConfirmDialogProps` exported from
 * `@/components/ui/ConfirmDialog` (inlined here: pure type, native
 * ui/ConfirmDialog component not yet ported). `loading` is part of the
 * dialog's own contract; useConfirm controls open/onConfirm/onCancel and
 * leaves loading to the dialog, exactly as on web. */
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  requireTypedConfirmation?: string;
  typedConfirmationLabel?: string;
  silenceKey?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/* ── Native-safe isSilenced ───────────────────────────────────
 * Read-only stand-in for `@/lib/confirmSilence`. The web lib persists a JSON
 * array of silenced action ids in localStorage; useConfirm only ever reads via
 * `isSilenced`, so only that path is reproduced. The exact STORAGE_KEY and
 * JSON-array schema are preserved so that on the react-native-web target this
 * interoperates with whatever writes silence entries (the future native
 * confirmSilence / ConfirmDialog ports). */
const SILENCE_STORAGE_KEY = 'teslasync:confirm-silence:v1';

interface WebStorageLike {
  getItem(key: string): string | null;
}

function getWebStorage(): WebStorageLike | undefined {
  const candidate = (
    globalThis as typeof globalThis & {localStorage?: WebStorageLike}
  ).localStorage;
  return candidate && typeof candidate.getItem === 'function'
    ? candidate
    : undefined;
}

/** Load the persisted set of silenced action ids (web localStorage on the
 * react-native-web target; empty set on a pure native runtime). Mirrors the
 * web `confirmSilence.load()` read path: JSON array of strings, deduped via a
 * Set, defensively returning an empty set on any parse/storage failure. */
function loadSilenced(): Set<string> {
  const store = getWebStorage();
  if (!store) {
    return new Set();
  }
  try {
    const raw = store.getItem(SILENCE_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

/** Returns true when the user previously opted to silence this action id.
 * Native-safe equivalent of `@/lib/confirmSilence`'s `isSilenced`. */
function isSilenced(key: string): boolean {
  if (!key) {
    return false;
  }
  return loadSilenced().has(key);
}

/** Explicit capability matrix for the native confirm-silence read surface. */
export const nativeConfirmSilenceCapabilities = {
  // Durable persistence is real on the react-native-web target (localStorage)
  // but unavailable on a pure native runtime, where loadSilenced() is always
  // empty and the dialog therefore re-prompts (the web safe default).
  durablePersistenceAvailable: false,
} as const;

/**
 * Options accepted by `confirm(opts)`. Mirrors the visual props of
 * `<ConfirmDialog>` minus the wiring fields (`open`, `onConfirm`, `onCancel`,
 * `loading`) which the hook controls internally.
 */
export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  requireTypedConfirmation?: string;
  typedConfirmationLabel?: string;
  /**
   * When set + non-destructive (variant !== 'danger', no typed gate), the
   * dialog renders a "Don't ask again" checkbox. Once the user opts in,
   * future `confirm()` calls with the same key short-circuit to `true`
   * without ever opening the modal — see `lib/confirmSilence.ts`.
   *
   * Provided values are still passed through for `danger`/typed prompts
   * but ignored — `<ConfirmDialog>` itself enforces the safety gate, so
   * call sites can use a stable `silenceKey` even when the variant is
   * dynamic.
   */
  silenceKey?: string;
}

interface InternalState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * Promise-based confirmation dialog hook.
 *
 * Renders ergonomic call sites for destructive actions: trigger the dialog
 * with `await confirm({...})`, then act on the boolean result. Spread
 * `dialogProps` onto a single `<ConfirmDialog>` somewhere in the component
 * tree to render the modal.
 *
 * @example
 *   const { confirm, dialogProps } = useConfirm()
 *   const handleDelete = async () => {
 *     const ok = await confirm({
 *       title: t('alerts.delete.title', 'Delete rule?'),
 *       message: t('alerts.delete.message', 'This cannot be undone.'),
 *       variant: 'danger',
 *       confirmLabel: t('common.delete', 'Delete'),
 *     })
 *     if (ok) deleteMutation.mutate(rule.id)
 *   }
 *   return (
 *     <>
 *       <Button onClick={handleDelete}>Delete</Button>
 *       {dialogProps && <ConfirmDialog {...dialogProps} />}
 *     </>
 *   )
 */
export function useConfirm() {
  const [state, setState] = useState<InternalState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    // Short-circuit silenced low-stakes prompts BEFORE mounting the dialog.
    // Mirror `<ConfirmDialog>`'s safety gate: never silence destructive or
    // typed-confirmation flows even if the caller passes a `silenceKey`.
    if (
      opts.silenceKey &&
      opts.variant !== 'danger' &&
      !opts.requireTypedConfirmation &&
      isSilenced(opts.silenceKey)
    ) {
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      setState(prev => {
        // If a previous dialog is somehow still open (rapid double-trigger),
        // resolve it as cancel before replacing it so no Promise leaks.
        if (prev) prev.resolve(false);
        return {...opts, resolve};
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState(current => {
      if (current) current.resolve(true);
      return null;
    });
  }, []);

  const handleCancel = useCallback(() => {
    setState(current => {
      if (current) current.resolve(false);
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
