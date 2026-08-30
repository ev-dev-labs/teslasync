import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABELS, type ActivityKind } from '@/types/activity';
import { KIND_ICON } from './constants';

export interface KindFilterBarProps {
  /** Currently active kinds. Empty means "all kinds" (the default). */
  activeKinds: readonly ActivityKind[];
  onChange: (kinds: ActivityKind[]) => void;
  className?: string;
}

/**
 * Multi-select toggle row for the activity timeline's `kind` filter. Unlike
 * `PillFilterBar` (single-select tablist), every kind can be toggled
 * independently, plus an "All" chip that clears the filter back to the
 * unscoped (all-kinds) default.
 */
export function KindFilterBar({ activeKinds, onChange, className }: KindFilterBarProps) {
  const { t } = useTranslation();
  const allSelected = activeKinds.length === 0;

  const toggle = (kind: ActivityKind) => {
    if (activeKinds.includes(kind)) {
      onChange(activeKinds.filter((k) => k !== kind));
    } else {
      onChange([...activeKinds, kind]);
    }
  };

  return (
    <div
      role="group"
      aria-label={t('activity.timeline.kindFilter.aria', 'Filter by activity kind')}
      className={cn('flex flex-wrap items-center gap-1.5', className)}
    >
      <Button
        type="button"
        size="sm"
        variant={allSelected ? 'primary' : 'secondary'}
        aria-pressed={allSelected}
        onClick={() => onChange([])}
      >
        {t('activity.timeline.kindFilter.all', 'All')}
      </Button>
      {ACTIVITY_KINDS.map((kind) => {
        const Icon = KIND_ICON[kind];
        const active = activeKinds.includes(kind);
        return (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant={active ? 'primary' : 'secondary'}
            aria-pressed={active}
            icon={<Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            onClick={() => toggle(kind)}
          >
            {t(`activity.timeline.kindFilter.${kind}`, ACTIVITY_KIND_LABELS[kind])}
          </Button>
        );
      })}
    </div>
  );
}
