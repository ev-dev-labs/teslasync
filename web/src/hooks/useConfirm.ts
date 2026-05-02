import { useCallback, useState } from 'react';
import type { ConfirmDialogProps } from '@/components/ui/ConfirmDialog';

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
    return new Promise((resolve) => {
      setState((prev) => {
        // If a previous dialog is somehow still open (rapid double-trigger),
        // resolve it as cancel before replacing it so no Promise leaks.
        if (prev) prev.resolve(false);
        return { ...opts, resolve };
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState((current) => {
      if (current) current.resolve(true);
      return null;
    });
  }, []);

  const handleCancel = useCallback(() => {
    setState((current) => {
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
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      }
    : null;

  return { confirm, dialogProps };
}
