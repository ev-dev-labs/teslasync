import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui';
import { ANNOTATION_COLORS } from '@/types/annotations';
import type { DataAnnotation } from '@/types/annotations';

interface AnnotationListProps {
  annotations: DataAnnotation[];
  onRemove: (id: string) => void;
}

export function AnnotationList({ annotations, onRemove }: AnnotationListProps) {
  const { t } = useTranslation();

  if (annotations.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
        {t('annotation.listTitle', 'Annotations')}
      </span>
      {annotations.map((ann) => (
        <div
          key={ann.id}
          className="group flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-xs dark:border-white/[0.04] dark:bg-white/[0.02]"
        >
          <div
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: ANNOTATION_COLORS[ann.category] }}
          />
          <span className="font-medium text-gray-700 dark:text-white/60">
            {ann.label}
          </span>
          {ann.description && (
            <span className="hidden truncate text-gray-400 dark:text-white/30 sm:inline">
              — {ann.description}
            </span>
          )}
          <span className="ml-auto shrink-0 text-gray-400 dark:text-white/30">
            {ann.timestamp}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(ann.id)}
            className="touch-target-overlay shrink-0 !h-5 !w-5 !p-0 text-gray-300 opacity-0 transition-all hover:!text-red-400 group-hover:opacity-100 dark:text-white/20"
            icon={<X className="h-3 w-3" />}
            aria-label={t('annotation.remove', 'Remove annotation')}
          />
        </div>
      ))}
    </div>
  );
}
