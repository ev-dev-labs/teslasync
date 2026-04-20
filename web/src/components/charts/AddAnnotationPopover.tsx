import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flag, Wrench, MapPin, AlertTriangle, ArrowUpCircle, Tag,
} from 'lucide-react';
import { Input, Button, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AnnotationCategory } from '@/types/annotations';
import { ANNOTATION_COLORS } from '@/types/annotations';

interface AddAnnotationPopoverProps {
  open: boolean;
  timestamp: string;
  onAdd: (label: string, category: AnnotationCategory, description?: string) => void;
  onCancel: () => void;
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
}: AddAnnotationPopoverProps) {
  const { t } = useTranslation();
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<AnnotationCategory>('milestone');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    onAdd(label.trim(), category, description.trim() || undefined);
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
        <div className="text-xs text-gray-400 dark:text-white/40">
          {timestamp}
        </div>

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
          <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('annotation.category', 'Category')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSelected = category === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCategory(opt.value)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    isSelected
                      ? 'border-current bg-gray-100 font-medium text-gray-900 dark:bg-white/10 dark:text-white/80'
                      : 'border-transparent text-gray-400 hover:text-gray-600 dark:text-white/30 dark:hover:text-white/50',
                  )}
                  style={
                    isSelected
                      ? { color: ANNOTATION_COLORS[opt.value] }
                      : undefined
                  }
                >
                  <Icon className="h-3 w-3" />
                  {t(`annotation.cat.${opt.value}`, opt.label)}
                </button>
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
