import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertOctagon, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { severityTokens, type Severity } from '@/lib/tokens';
import { isSilenced, silence } from '@/lib/confirmSilence';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Optional structured impact details rendered between the warning and actions. */
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  /**
   * When true, both buttons are disabled and the confirm button shows a spinner.
   * Use this when the parent keeps the dialog open while a mutation is in flight.
   */
  loading?: boolean;
  /** Disable confirmation until caller-owned validation (for example, a required reason) passes. */
  confirmDisabled?: boolean;
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
  warning: 'bg-amber-500 text-[var(--text-primary)] hover:bg-amber-600 focus-visible:ring-amber-500',
};

export function ConfirmDialog({
  open,
  title,
  message,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  confirmDisabled: disabledByCaller = false,
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

  // Silencing is only honored for non-destructive prompts. Danger variant
  // and typed-confirmation gates always re-prompt regardless of caller.
  const silenceHonored = Boolean(
    silenceKey && variant !== 'danger' && !requireTypedConfirmation,
  );

  // Reset typed input AND the "don't ask again" checkbox each time the
  // dialog reopens so a stale value from a previous invocation can't
  // bypass the typed-confirmation gate or pre-tick the silence checkbox.
  useEffect(() => {
    if (open) {
      setTyped('');
      setDontAskAgain(false);
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

  // Escape key triggers cancel (Modal already handles backdrop click via
  // its overlay onClose). Suppressed while loading to prevent dismissing a
  // mutation in flight.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, loading, onCancel]);

  const typedMatches = !requireTypedConfirmation || typed === requireTypedConfirmation;
  const confirmDisabled = loading || disabledByCaller || !typedMatches;

  // While loading we swallow the backdrop-click close handler to keep the
  // dialog mounted until the mutation resolves; otherwise route to onCancel.
  const handleModalClose = useCallback(() => {
    if (loading) return;
    onCancel();
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
    <Modal open={open} onClose={handleModalClose} title={title} size="sm">
      <div className="space-y-4">
        <div className={cn('flex items-start gap-3 rounded-lg border p-3', tokens.bg, tokens.border)}>
          {Icon && <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', tokens.fg)} aria-hidden="true" />}
          <p className="text-sm text-[var(--text-primary)]">{message}</p>
        </div>
        {details}
        {requireTypedConfirmation && (
          <Input
            label={inputLabel}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={requireTypedConfirmation}
            disabled={loading}
            autoComplete="off"
            spellCheck={false}
            aria-label={inputLabel}
          />
        )}
        {silenceHonored && (
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
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
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            className={confirmButtonClasses[variant]}
            onClick={handleConfirmClick}
            loading={loading}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
