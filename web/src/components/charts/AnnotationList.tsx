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

  // Defensive: this list is fed from the async annotations hook, which can
  // hand us `undefined`/`null` before it resolves. Guard the `.length`/`.map`
  // so a not-yet-loaded state renders nothing instead of throwing (mirrors the
  // sibling `renderAnnotationLines` helper).
  const items = annotations ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      <Text as="span" variant="metricLabel">
        {t('annotation.listTitle', 'Annotations')}
      </Text>
      {items.map((ann) => {
        const label = ann.label ?? '—';
        // Unknown / forward-compat categories must not yield an uncolored
        // (transparent) dot — fall back to the neutral custom swatch.
        const color = ANNOTATION_COLORS[ann.category] ?? ANNOTATION_COLORS.custom;
        return (
          <div
            key={ann.id}
            className="group flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-1.5 text-xs"
          >
            <div
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <Text as="span" weight="medium" color="secondary">
              {label}
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
              aria-label={t('annotation.removeNamed', 'Remove annotation: {{label}}', {
                label,
              })}
            />
          </div>
        );
      })}
    </div>
  );
}
