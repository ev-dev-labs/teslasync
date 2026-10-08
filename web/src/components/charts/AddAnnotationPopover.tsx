import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flag, Wrench, MapPin, AlertTriangle, ArrowUpCircle, Tag,
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ErrorText, HelperText, Text } from '@/components/ui/Typography';
import { Icon } from '@/components/ui/Icon';
import type { AnnotationCategory } from '@/types/annotations';

/**
 * Normalises any ISO-ish timestamp into the `YYYY-MM-DD` value expected by
 * `<input type="date">`. Returns an empty string when parsing fails so the
 * input renders empty rather than NaN.
 */
export function toDateInputValue(timestamp: string): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) {
    // Already in YYYY-MM-DD shape — accept verbatim.
    return /^\d{4}-\d{2}-\d{2}$/.test(timestamp) ? timestamp : '';
  }
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Inverse of `toDateInputValue` — pins a YYYY-MM-DD value to UTC midnight. */
export function toIsoTimestamp(date: string): string {
  if (!date) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return `${date}T00:00:00Z`;
}

interface AddAnnotationPopoverProps {
  open: boolean;
  timestamp: string;
  onAdd: (label: string, category: AnnotationCategory, description?: string, occurredAt?: string) => void | Promise<void>;
  onAdded?: () => void;
  onCancel: () => void;
  /** When true, the timestamp becomes editable via a `<Input type="date">`.
   *  Used by the new managed `<ChartContainer annotations>` flow where the
   *  user picks the date from the header rather than clicking the chart. */
  editableDate?: boolean;
}

const CATEGORY_OPTIONS: ReadonlyArray<{
  value: AnnotationCategory;
  label: string;
  icon: typeof Flag;
}> = [
  { value: 'milestone', label: 'Milestone', icon: Flag },
  { value: 'maintenance', label: 'Maintenance', icon: Wrench },
  { value: 'trip', label: 'Trip', icon: MapPin },
  { value: 'issue', label: 'Issue', icon: AlertTriangle },
  { value: 'upgrade', label: 'Upgrade', icon: ArrowUpCircle },
  { value: 'custom', label: 'Custom', icon: Tag },
];

export function AddAnnotationPopover({
  open,
  timestamp,
  onAdd,
  onAdded,
  onCancel,
  editableDate = false,
}: AddAnnotationPopoverProps) {
  const { t } = useTranslation();
  const categoryLabelId = useId();
  const feedbackId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const retainDate = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notificationFailed, setNotificationFailed] = useState(false);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<AnnotationCategory>('milestone');
  const [description, setDescription] = useState('');
  const [editedDate, setEditedDate] = useState(() => toDateInputValue(timestamp));

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    // Native capture also contains keys from a focused control disabled by saving.
    const containPendingEscape = (event: KeyboardEvent) => {
      if (!inFlight.current || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // Disabled focused fields can dispatch to body; match the shared focus owner's
    // topmost-dialog recovery before document-level outer dismissal listeners.
    const containPendingBodyEscape = (event: KeyboardEvent) => {
      if (event.target !== document.body) return;
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
      if (dialogs[dialogs.length - 1] === dialog) containPendingEscape(event);
    };
    dialog.addEventListener('keydown', containPendingEscape, true);
    document.addEventListener('keydown', containPendingBodyEscape, true);
    return () => {
      dialog.removeEventListener('keydown', containPendingEscape, true);
      document.removeEventListener('keydown', containPendingBodyEscape, true);
    };
  }, [open]);

  // Re-sync the date field whenever the popover re-opens with a fresh
  // timestamp (e.g. user clicked a different point on the chart).
  useEffect(() => {
    if (open && !inFlight.current && !retainDate.current) setEditedDate(toDateInputValue(timestamp));
  }, [open, timestamp]);

  const resetDraft = () => {
    setLabel('');
    setCategory('milestone');
    setDescription('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current || notificationFailed || !label.trim()) return;
    const occurredAt = editableDate ? toIsoTimestamp(editedDate) : timestamp;
    if (!occurredAt) return;
    inFlight.current = true;
    const attempt = ++generation.current;
    const isCurrent = () => mounted.current && generation.current === attempt;
    const reject = () => {
      if (!isCurrent()) return;
      inFlight.current = false;
      retainDate.current = true;
      setPending(false);
      setFailed(true);
    };
    const accept = () => {
      if (!isCurrent()) return;
      setPending(false);
      setFailed(false);
      retainDate.current = false;
      resetDraft();
      // Notification is not persistence: its failure must never enable create retry.
      const reportNotificationFailure = () => {
        if (isCurrent()) setNotificationFailed(true);
      };
      try {
        void Promise.resolve(onAdded?.()).catch(reportNotificationFailure);
      } catch {
        reportNotificationFailure();
      } finally {
        if (isCurrent()) inFlight.current = false;
      }
    };
    setFailed(false);
    setNotificationFailed(false);
    let result: void | Promise<void>;
    try {
      result = onAdd(label.trim(), category, description.trim() || undefined, occurredAt);
    } catch {
      reject();
      return;
    }
    if (result) {
      setPending(true);
      void result.then(accept, reject);
    } else {
      accept();
    }
  };

  const handleClose = () => {
    if (inFlight.current) return;
    generation.current += 1;
    retainDate.current = false;
    resetDraft();
    setFailed(false);
    setNotificationFailed(false);
    onCancel();
  };

  return (
    <Modal
      ref={dialogRef}
      open={open}
      onClose={handleClose}
      title={t('annotation.addTitle', 'Add Annotation')}
      size="sm"
      onKeyDownCapture={(e) => {
        if (inFlight.current && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-busy={pending || undefined}
        aria-describedby={pending || failed || notificationFailed ? feedbackId : undefined}
      >
        {editableDate ? (
          <Input
            type="date"
            value={editedDate}
            onChange={(e) => { if (!inFlight.current && !notificationFailed) setEditedDate(e.target.value); }}
            disabled={pending || notificationFailed}
            label={t('annotation.date', 'Date')}
            max={toDateInputValue(new Date().toISOString())}
            required
          />
        ) : (
          <Text as="div" variant="caption" className="break-words">
            {timestamp}
          </Text>
        )}

        <Input
          value={label}
          onChange={(e) => { if (!inFlight.current && !notificationFailed) setLabel(e.target.value); }}
          disabled={pending || notificationFailed}
          placeholder={t('annotation.labelPlaceholder', 'e.g., Battery replaced')}
          autoFocus
          maxLength={50}
          label={t('annotation.label', 'Label')}
        />

        <div>
          <Text as="span" variant="label" className="mb-2 block" id={categoryLabelId}>
            {t('annotation.category', 'Category')}
          </Text>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={categoryLabelId}>
            {CATEGORY_OPTIONS.map((opt) => {
              const isSelected = category === opt.value;
              return (
                <Button
                  key={opt.value}
                  type="button"
                  variant={isSelected ? 'secondary' : 'ghost'}
                  size="sm"
                  wrapLabel
                  icon={<Icon icon={opt.icon} size="sm" />}
                  onClick={() => { if (!inFlight.current && !notificationFailed) setCategory(opt.value); }}
                  disabled={pending || notificationFailed}
                  aria-pressed={isSelected}
                  className="min-h-11 md:min-h-9"
                >
                  {t(`annotation.cat.${opt.value}`, opt.label)}
                </Button>
              );
            })}
          </div>
        </div>

        <Input
          value={description}
          onChange={(e) => { if (!inFlight.current && !notificationFailed) setDescription(e.target.value); }}
          disabled={pending || notificationFailed}
          placeholder={t('annotation.descPlaceholder', 'Optional description...')}
          maxLength={200}
          label={t('annotation.description', 'Description')}
        />

        {pending && <HelperText id={feedbackId} role="status">{t('common.saving', 'Saving…')}</HelperText>}
        {failed && (
          <ErrorText id={feedbackId}>
            {t('toast.annotation.created.error', 'Failed to add annotation')}. {t('statusBar.background.tryAgain', 'Please try again')}
          </ErrorText>
        )}
        {notificationFailed && (
          <ErrorText id={feedbackId}>
            {t('toast.annotation.created.success', 'Annotation added')}. {t('toast.common.error', 'Something went wrong')}
          </ErrorText>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" wrapLabel className="min-h-11 md:min-h-9" type="button" onClick={handleClose} disabled={pending}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button size="sm" wrapLabel className="min-h-11 md:min-h-9" type="submit" disabled={pending || notificationFailed || !label.trim()} loading={pending}>
            {t('annotation.add', 'Add Annotation')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
