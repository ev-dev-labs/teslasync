import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Text } from '../ui/Typography';
import { Icon } from '../ui/Icon';
import { neonColorMap, type NeonColor } from '@/lib/tokens';
import type { AnnotationCategory, DataAnnotation } from '@/types/annotations';

const categoryTones: Record<AnnotationCategory, NeonColor> = {
  milestone: 'blue',
  maintenance: 'amber',
  trip: 'green',
  issue: 'red',
  upgrade: 'purple',
  custom: 'neutral',
};

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
        const tone = categoryTones[ann.category] ?? categoryTones.custom;
        return (
          <div
            key={ann.id}
            className="group flex min-w-0 items-start gap-2 rounded-shape-sm border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2"
          >
            <div
              className={`mt-2 h-2 w-2 shrink-0 rounded-full ${neonColorMap[tone].dot}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <Text as="span" variant="label" className="block break-words">
                {label}
              </Text>
              {ann.description && (
                <Text as="span" variant="bodySm" className="block break-words">
                  — {ann.description}
                </Text>
              )}
              <Text as="span" variant="caption" className="block break-all">
                {ann.timestamp}
              </Text>
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => onRemove(ann.id)}
              className="h-11 w-11 shrink-0 p-0 md:h-9 md:w-9"
              icon={<Icon icon={X} size="sm" />}
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
