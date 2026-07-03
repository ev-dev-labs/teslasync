import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button, Text } from '@/components/ui';
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
      <Text as="span" variant="metricLabel">
        {t('annotation.listTitle', 'Annotations')}
      </Text>
      {annotations.map((ann) => (
        <div
          key={ann.id}
          className="group flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-xs dark:border-white/[0.04] dark:bg-white/[0.02]"
        >
          <div
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: ANNOTATION_COLORS[ann.category] }}
          />
          <Text as="span" weight="medium" color="secondary">
            {ann.label}
          </Text>
          {ann.description && (
            <Text as="span" color="muted" className="hidden truncate sm:inline">
              — {ann.description}
            </Text>
          )}
          <Text as="span" color="muted" className="ml-auto shrink-0">
            {ann.timestamp}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(ann.id)}
            className="touch-target-overlay shrink-0 !h-5 !w-5 !p-0 text-[var(--text-muted)] opacity-0 transition-all hover:!text-red-400 group-hover:opacity-100"
            icon={<X className="h-3 w-3" />}
            aria-label={t('annotation.remove', 'Remove annotation')}
          />
        </div>
      ))}
    </div>
  );
}
