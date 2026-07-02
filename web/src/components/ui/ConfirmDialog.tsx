import { useCallback, useEffect, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { AlertOctagon, AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { severityTokens, type Severity } from '@/lib/tokens';
import { isSilenced, silence } from '@/lib/confirmSilence';
import { Button } from './Button';
import { Input } from './Input';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  /**
   * When true, both buttons are disabled and the confirm button shows a spinner.
   * Use this when the parent keeps the dialog open while a mutation is in flight.
   */
  loading?: boolean;
  /**
   * For extra-dangerous actions (delete vehicle, wipe database). The confirm
   * button stays disabled until the user types this exact string into the
   * confirmation input.
   */
  requireTypedConfirmation?: string;
  /**
   * Optional caller-supplied label for the typed-confirmation input. Keep
   * configurable so callers can localize via `t()`. Defaults to an English
   * fallback containing the required string.
   */
  typedConfirmationLabel?: string;
  /**
   * Stable action id that, when set, lets the user opt out of future
   * prompts via a "Don't ask again" checkbox. The choice is persisted in
   * `localStorage` (see `lib/confirmSilence.ts`) and short-circuits the
   * dialog on subsequent calls — `onConfirm` fires immediately and the
   * dialog never renders.
   *
   * **Ignored** for `variant === 'danger'` and any prompt that sets
   * `requireTypedConfirmation` — destructive actions must always confirm.
   * Callers may still pass `silenceKey` on those without effect, which
   * keeps call sites simple when the variant is dynamic.
   */
  silenceKey?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const variantToSeverity: Record<NonNullable<ConfirmDialogProps['variant']>, Severity> = {
  danger: 'critical',
  warning: 'warn',
};

const iconComponents = { AlertOctagon, AlertTriangle } as const;

const confirmButtonClasses: Record<NonNullable<ConfirmDialogProps['variant']>, string | undefined> = {
  // Button's built-in 'danger' variant covers the critical case.
  danger: undefined,
  // Button has no 'warning' variant — override with solid amber via className.
  warning: 'bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500',
};

/**
 * `<ConfirmDialog>` is built directly on Radix's `AlertDialog` primitive
 * (not the hand-rolled `<Modal>`) to get a correct `role="alertdialog"`,
 * a managed focus trap, and `Title`/`Description` aria wiring for free.
 * A few deliberate consequences of that choice, called out here so future
 * readers don't "fix" them back to `<Modal>`-like behavior:
 *
 * 1. Outside click (the overlay) no longer dismisses the dialog. Radix's
 *    `AlertDialogContent` hard-codes `onPointerDownOutside`/`onInteractOutside`
 *    to `preventDefault()` with no escape hatch — this matches the WAI-ARIA
 *    Alert Dialog pattern (a decision prompt should not be dismissible by an
 *    accidental outside click) and is Radix's intentional design, not a bug.
 *    Cancel/Escape/the header close button all still work.
 * 2. The Confirm button is a plain `<Button>`, NOT `<AlertDialog.Action>`.
 *    `AlertDialog.Action` (like `.Cancel`) always fires `onOpenChange(false)`
 *    on click in addition to its `onClick`. Since Cancel already routes
 *    dismissal through `onOpenChange` (see `handleOpenChange` below), wiring
 *    Confirm the same way would fire `onCancel` immediately after
 *    `onConfirm` for a single click. Keeping Confirm plain preserves the
 *    original contract: confirming never auto-closes anything, the caller
 *    decides (e.g. keep `open` true + `loading` true while a mutation runs).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  requireTypedConfirmation,
  typedConfirmationLabel,
  silenceKey,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const sev = variantToSeverity[variant];
  const tokens = severityTokens[sev];
  const Icon = iconComponents[tokens.icon as keyof typeof iconComponents];
  const [typed, setTyped] = useState('');
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const typedInputRef = useRef<HTMLInputElement | null>(null);
  // Radix's default `onCloseAutoFocus` restores focus to an
  // `<AlertDialog.Trigger>` — this component has none (it's opened via the
  // externally-controlled `open` prop), so we track + restore the invoking
  // element ourselves, matching the previous <Modal>-based behavior.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Silencing is only honored for non-destructive prompts. Danger variant
  // and typed-confirmation gates always re-prompt regardless of caller.
  const silenceHonored = Boolean(
    silenceKey && variant !== 'danger' && !requireTypedConfirmation,
  );

  // Reset typed input AND the "don't ask again" checkbox each time the
  // dialog reopens so a stale value from a previous invocation can't
  // bypass the typed-confirmation gate or pre-tick the silence checkbox.
  // Also capture whatever had focus before opening, for restore-on-close.
  useEffect(() => {
    if (open) {
      setTyped('');
      setDontAskAgain(false);
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    }
  }, [open]);

  // Auto-resolve when the user previously silenced this action: fire the
  // confirm callback as soon as `open` flips true. The early `return null`
  // below prevents any flash of the dialog before React commits the parent's
  // resulting `open=false`.
  useEffect(() => {
    if (open && silenceHonored && silenceKey && isSilenced(silenceKey)) {
      onConfirm();
    }
  }, [open, silenceHonored, silenceKey, onConfirm]);

  const typedMatches = !requireTypedConfirmation || typed === requireTypedConfirmation;
  const confirmDisabled = loading || !typedMatches;

  // Single source of truth for "the dialog wants to dismiss without an
  // explicit Confirm": fires for Escape (via the default behavior let
  // through by onEscapeKeyDown below) and for Cancel/header-close clicks
  // (both `<AlertDialog.Cancel>`, which always signals onOpenChange(false)).
  // The `!loading` guard is defensive — both callers already gate on
  // `loading` upstream (native `disabled` on the buttons, preventDefault in
  // onEscapeKeyDown), so this should never actually see loading=true.
  const handleOpenChange = useCallback((next: boolean) => {
    if (!next && !loading) onCancel();
  }, [loading, onCancel]);

  // Persist the silence choice BEFORE bubbling up to the parent so the
  // next call sees the updated localStorage value.
  const handleConfirmClick = useCallback(() => {
    if (silenceHonored && silenceKey && dontAskAgain) {
      silence(silenceKey);
    }
    onConfirm();
  }, [silenceHonored, silenceKey, dontAskAgain, onConfirm]);

  const inputLabel = typedConfirmationLabel
    ?? (requireTypedConfirmation ? `Type "${requireTypedConfirmation}" to confirm` : '');

  // Suppress the dialog entirely when silenced — the auto-resolve effect
  // above will fire `onConfirm` on the next tick.
  if (open && silenceHonored && silenceKey && isSilenced(silenceKey)) {
    return null;
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className={cn('fixed inset-0 z-[60] bg-[var(--surface-overlay)] backdrop-blur-sm forced-colors:bg-[Canvas]')}
        />
        <AlertDialog.Content
          className={cn(
            'fixed inset-0 z-[60] overflow-y-auto outline-hidden',
          )}
          onEscapeKeyDown={(e) => {
            // Radix closes on Escape by default (routed through
            // handleOpenChange above) — suppress while a mutation is in
            // flight so the caller doesn't lose the dialog mid-request.
            if (loading) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            // Default AlertDialog behavior focuses the Cancel button (the
            // safe action). For typed-confirmation prompts the very next
            // thing the user needs to do is type, so send focus there
            // instead.
            if (requireTypedConfirmation && typedInputRef.current) {
              e.preventDefault();
              typedInputRef.current.focus();
            }
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            previouslyFocusedRef.current?.focus?.();
          }}
        >
          <div className="relative flex min-h-full items-end justify-center sm:items-center sm:p-4">
            <div
              className={cn(
                'relative z-10 flex w-full flex-col bg-[var(--surface-1)] text-[var(--text-primary)] shadow-xl outline-hidden',
                'border border-[var(--glass-border)]',
                'forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
                'max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[90vh] sm:rounded-lg',
                'sm:max-w-sm',
              )}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--glass-border)] px-4 pt-4 pb-3 sm:px-6 sm:pt-6 sm:pb-4">
                <AlertDialog.Title className="min-w-0 truncate text-lg font-semibold text-[var(--text-primary)]">
                  {title}
                </AlertDialog.Title>
                <AlertDialog.Cancel asChild>
                  <button
                    type="button"
                    disabled={loading}
                    aria-label={t('confirm.close', 'Close')}
                    className={cn(
                      'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
                      'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
                      'active:scale-95 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]',
                      'disabled:pointer-events-none disabled:opacity-50',
                    )}
                  >
                    <X className="h-5 w-5" aria-hidden="true" />
                  </button>
                </AlertDialog.Cancel>
              </div>
              <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3 sm:px-6 sm:pb-6 safe-bottom space-y-4">
                <div className={cn('flex items-start gap-3 rounded-lg border p-3', tokens.bg, tokens.border)}>
                  {Icon && <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', tokens.fg)} aria-hidden="true" />}
                  <AlertDialog.Description className="text-sm text-[var(--text-primary)]">
                    {message}
                  </AlertDialog.Description>
                </div>
                {requireTypedConfirmation && (
                  <Input
                    ref={typedInputRef}
                    label={inputLabel}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    // A persistent hint stays on screen the whole time the
                    // user is typing (unlike ghost text baked into the
                    // empty-field appearance, which disappears on the first
                    // keystroke) — matters most when `typedConfirmationLabel`
                    // is a generic instruction that doesn't itself spell out
                    // the value, e.g. "Type the VIN to confirm".
                    hint={t('confirm.typedConfirmationHint', 'Type exactly: "{{value}}"', { value: requireTypedConfirmation })}
                    disabled={loading}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={inputLabel}
                  />
                )}
                {silenceHonored && (
                  <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={dontAskAgain}
                      onChange={(e) => setDontAskAgain(e.target.checked)}
                      disabled={loading}
                      className="rounded border-[var(--border-strong)] bg-[var(--surface-2)] text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0"
                      aria-label={t('confirm.silence.checkbox', "Don't ask again for this action")}
                    />
                    <span>{t('confirm.silence.checkbox', "Don't ask again for this action")}</span>
                  </label>
                )}
                <div className="flex items-center justify-end gap-2">
                  <AlertDialog.Cancel asChild>
                    <Button type="button" variant="secondary" disabled={loading} className="min-h-11">
                      {cancelLabel}
                    </Button>
                  </AlertDialog.Cancel>
                  <Button
                    type="button"
                    variant={variant === 'danger' ? 'danger' : 'primary'}
                    className={cn('min-h-11', confirmButtonClasses[variant])}
                    onClick={handleConfirmClick}
                    loading={loading}
                    disabled={confirmDisabled}
                  >
                    {confirmLabel}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
