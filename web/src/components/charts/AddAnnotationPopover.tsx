import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flag, Wrench, MapPin, AlertTriangle, ArrowUpCircle, Tag,
} from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Text } from '@/components/ui/Typography';
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
  onAdd: (label: string, category: AnnotationCategory, description?: string, occurredAt?: string) => void;
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
  onCancel,
  editableDate = false,
}: AddAnnotationPopoverProps) {
  const { t } = useTranslation();
  const categoryLabelId = useId();
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<AnnotationCategory>('milestone');
  const [description, setDescription] = useState('');
  const [editedDate, setEditedDate] = useState(() => toDateInputValue(timestamp));

  // Re-sync the date field whenever the popover re-opens with a fresh
  // timestamp (e.g. user clicked a different point on the chart).
  useEffect(() => {
    if (open) setEditedDate(toDateInputValue(timestamp));
  }, [open, timestamp]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    const occurredAt = editableDate ? toIsoTimestamp(editedDate) : timestamp;
    if (!occurredAt) return;
    onAdd(label.trim(), category, description.trim() || undefined, occurredAt);
    setLabel('');
    setCategory('milestone');
    setDescription('');
  };

  const handleClose = () => {
    setLabel('');
    setCategory('milestone');
    setDescription('');
    onCancel();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('annotation.addTitle', 'Add Annotation')}
      size="sm"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {editableDate ? (
          <Input
            type="date"
            value={editedDate}
            onChange={(e) => setEditedDate(e.target.value)}
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
          onChange={(e) => setLabel(e.target.value)}
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
                  onClick={() => setCategory(opt.value)}
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
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('annotation.descPlaceholder', 'Optional description...')}
          maxLength={200}
          label={t('annotation.description', 'Description')}
        />

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" wrapLabel className="min-h-11 md:min-h-9" type="button" onClick={handleClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button size="sm" wrapLabel className="min-h-11 md:min-h-9" type="submit" disabled={!label.trim()}>
            {t('annotation.add', 'Add Annotation')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
