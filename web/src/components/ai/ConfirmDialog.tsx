// Phase-50 / 0005 — F4 AI Tool-Use Framework.
//
// AiConfirmDialog renders the user-facing confirmation prompt for a
// dispatcher-paused mutating tool call. Distinct from the generic
// `ui/ConfirmDialog` (destructive-action wording): this dialog
// surfaces what the LLM proposed (tool name + JSON args) and the
// audit context, so the user can verify the AI is about to do
// exactly what they expect before approving.
//
// ADR-015 invariants
// ------------------
//   §I1  Default-off          — the dialog renders only when its
//                                parent (a Strategy-mounted page)
//                                says open=true. Off mode never
//                                instantiates the parent.
//   §I3  Baseline intact      — the user has explicit Confirm/Cancel
//                                affordances; nothing fires
//                                automatically.
//   §I9  Provenance visible   — the tool name and the JSON arguments
//                                the LLM emitted are rendered
//                                verbatim. The user can see exactly
//                                what is about to happen.
//
// The dialog is i18n-aware via react-i18next; English fallbacks are
// inlined so a missing locale key never strands the UI in
// translation-key tokens.

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useTranslation } from 'react-i18next';

export interface AiToolPreview {
  name: string;
  description?: string;
  mutates: boolean;
}

export interface AiConfirmDialogProps {
  /**
   * Whether the dialog is visible. When false the component
   * renders nothing (Modal handles the render gate).
   */
  open: boolean;

  /**
   * Tool metadata as supplied by the dispatcher's confirm_request
   * SSE frame. The name/description are surfaced to the user.
   */
  tool: AiToolPreview;

  /**
   * Tool arguments as proposed by the LLM. Rendered verbatim in a
   * monospaced block so the user can verify exactly what will
   * happen. May be null/undefined for tools with no input.
   */
  args?: Record<string, unknown> | null;

  /**
   * Confirm handler. Parent component is responsible for forwarding
   * the decision to the continuation endpoint.
   */
  onConfirm: () => void;

  /**
   * Cancel handler. Parent component MUST close the dialog AND
   * notify the continuation endpoint that the user denied so the
   * dispatcher can release the paused state.
   */
  onCancel: () => void;

  /**
   * When true, both buttons disable and the confirm button shows a
   * spinner — used while the continuation POST is in flight.
   */
  loading?: boolean;
}

export function AiConfirmDialog({
  open,
  tool,
  args,
  onConfirm,
  onCancel,
  loading = false,
}: AiConfirmDialogProps) {
  const { t } = useTranslation();

  const title = t('ai.confirm.title', 'Approve AI action');
  const intro = tool.mutates
    ? t(
        'ai.confirm.intro.mutates',
        'The assistant wants to make a change to your data. Review what it will do, then approve or cancel.',
      )
    : t(
        'ai.confirm.intro.read',
        'The assistant wants to run a tool. Review the inputs, then approve or cancel.',
      );
  const argsLabel = t('ai.confirm.argsLabel', 'Arguments');
  const toolLabel = t('ai.confirm.toolLabel', 'Tool');
  const confirmLabel = t('ai.confirm.run', 'Approve');
  const cancelLabel = t('ai.confirm.cancel', 'Cancel');

  const argsJson = JSON.stringify(args ?? {}, null, 2);

  return (
    <Modal open={open} onClose={loading ? () => undefined : onCancel} title={title} size="md">
      <div className="space-y-4" data-testid="ai-confirm-dialog">
        <p className="text-sm text-[var(--text-primary)]">{intro}</p>

        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{toolLabel}</div>
          <div className="font-mono text-sm text-[var(--text-primary)]" data-testid="ai-confirm-tool-name">
            {tool.name}
          </div>
          {tool.description && (
            <p className="text-sm text-[var(--text-secondary)]">{tool.description}</p>
          )}
        </div>

        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{argsLabel}</div>
          <pre
            data-testid="ai-confirm-args"
            className="overflow-auto rounded-md border border-[var(--border-strong)] bg-[var(--surface-2)] p-3 text-xs text-[var(--text-primary)] font-mono"
          >
            {argsJson}
          </pre>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading} data-testid="ai-confirm-cancel">
            {cancelLabel}
          </Button>
          <Button type="button" variant="primary" onClick={onConfirm} loading={loading} disabled={loading} data-testid="ai-confirm-approve">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
