import { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { severityTokens, type Severity } from '@/lib/tokens';
import { Modal } from './Modal';
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const sev = variantToSeverity[variant];
  const tokens = severityTokens[sev];
  const Icon = iconComponents[tokens.icon as keyof typeof iconComponents];
  const [typed, setTyped] = useState('');

  // Reset typed input each time the dialog reopens so a stale value from a
  // previous invocation can't bypass the typed-confirmation gate.
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

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
  const confirmDisabled = loading || !typedMatches;

  // While loading we swallow the backdrop-click close handler to keep the
  // dialog mounted until the mutation resolves; otherwise route to onCancel.
  const handleModalClose = useCallback(() => {
    if (loading) return;
    onCancel();
  }, [loading, onCancel]);

  const inputLabel = typedConfirmationLabel
    ?? (requireTypedConfirmation ? `Type "${requireTypedConfirmation}" to confirm` : '');

  return (
    <Modal open={open} onClose={handleModalClose} title={title} size="sm">
      <div className="space-y-4">
        <div className={cn('flex items-start gap-3 rounded-lg border p-3', tokens.bg, tokens.border)}>
          {Icon && <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', tokens.fg)} aria-hidden="true" />}
          <p className="text-sm text-[var(--text-primary)]">{message}</p>
        </div>
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
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            className={confirmButtonClasses[variant]}
            onClick={onConfirm}
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

