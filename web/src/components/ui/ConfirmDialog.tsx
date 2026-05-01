import { AlertOctagon, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { severityTokens, type Severity } from '@/lib/tokens';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const sev = variantToSeverity[variant];
  const tokens = severityTokens[sev];
  const Icon = iconComponents[tokens.icon as keyof typeof iconComponents];

  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="space-y-4">
        <div className={cn('flex items-start gap-3 rounded-lg border p-3', tokens.bg, tokens.border)}>
          {Icon && <Icon className={cn('h-5 w-5 mt-0.5 shrink-0', tokens.fg)} aria-hidden="true" />}
          <p className="text-sm text-[var(--text-primary)]">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'danger' : 'primary'}
            className={confirmButtonClasses[variant]}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

