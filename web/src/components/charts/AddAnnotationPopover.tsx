import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flag, Wrench, MapPin, AlertTriangle, ArrowUpCircle, Tag,
} from 'lucide-react';
import { Input, Button, Modal, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AnnotationCategory } from '@/types/annotations';
import { ANNOTATION_COLORS } from '@/types/annotations';

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
          <Text as="div" variant="caption">
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

        {/* Category pills */}
        <div>
          <Text as="span" variant="subhead" className="mb-1.5 block" id={categoryLabelId}>
            {t('annotation.category', 'Category')}
          </Text>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={categoryLabelId}>
            {CATEGORY_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSelected = category === opt.value;
              return (
                <Button
                  key={opt.value}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCategory(opt.value)}
                  aria-pressed={isSelected}
                  className={cn(
                    '!h-auto rounded-full border px-2.5 py-1 text-xs font-normal',
                    isSelected
                      ? 'border-current bg-[var(--control-bg)] font-medium'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                  )}
                  style={
                    isSelected
                      ? { color: ANNOTATION_COLORS[opt.value] }
                      : undefined
                  }
                >
                  <Icon className="h-3 w-3" />
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

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" type="button" onClick={handleClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button size="sm" type="submit" disabled={!label.trim()}>
            {t('annotation.add', 'Add Annotation')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
