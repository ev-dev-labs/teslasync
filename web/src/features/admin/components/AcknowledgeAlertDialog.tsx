/**
 * Modal opened from the alert row's "Acknowledge" button.
 *
 * Lets the user
 * record an optional free-text note (≤1000 chars after trimming) before
 * firing the ack mutation. Empty/whitespace notes are accepted — the
 * backend treats them as "ack with no note" so the audit timeline still
 * captures who+when.
 *
 * Submit + Cancel both close the dialog. The actual mutation is owned by
 * the parent (AlertsPage) so that hook/cache wiring stays colocated with
 * the page that uses it.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';

const NOTE_MAX = 1000;

export interface AcknowledgeAlertDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called with the trimmed note (which may be the empty string when the
   * user leaves the textarea blank). The parent is responsible for firing
   * the mutation and showing toast / undo affordances.
   */
  onSubmit: (note: string) => void;
  /** When true, disables Submit/Cancel and shows an in-button busy hint. */
  submitting?: boolean;
  /** Title of the alert being acked, shown as a subtitle for context. */
  alertTitle?: string;
}

export function AcknowledgeAlertDialog({
  open,
  onClose,
  onSubmit,
  submitting = false,
  alertTitle,
}: AcknowledgeAlertDialogProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hintId = useId();

  // Reset the note whenever the dialog reopens — stale text from a previous
  // alert would be confusing if the user opens, cancels, then opens again
  // for a different row.
  useEffect(() => {
    if (open) {
      setNote('');
      // Defer focus to the textarea after Modal's own focus-trap moves
      // focus into the dialog.
      const id = window.setTimeout(() => textareaRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const trimmed = note.trim();
  const tooLong = trimmed.length > NOTE_MAX;

  const handleSubmit = () => {
    if (submitting || tooLong) return;
    onSubmit(trimmed);
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={t('alerts.ack.dialogTitle', 'Acknowledge alert')}
      size="md"
    >
      <div className="space-y-4">
        {alertTitle ? (
          <p className="text-sm text-[var(--text-secondary)]">{alertTitle}</p>
        ) : null}
        <Textarea
          ref={textareaRef}
          label={t('alerts.ack.noteLabel', 'Note (optional)')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('alerts.ack.notePlaceholder', "Optional: what's being done?")}
          maxLength={NOTE_MAX + 50}
          rows={4}
          aria-describedby={hintId}
          disabled={submitting}
          error={tooLong ? t('alerts.ack.noteHint', 'Up to {{max}} characters. Shared in the audit timeline.', { max: NOTE_MAX }) : undefined}
        />
        <p id={hintId} className="text-[11px] text-[var(--text-muted)]">
          {t('alerts.ack.noteHint', 'Up to {{max}} characters. Shared in the audit timeline.', { max: NOTE_MAX })}
        </p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('alerts.ack.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || tooLong}>
            {t('alerts.ack.submit', 'Acknowledge')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default AcknowledgeAlertDialog;
