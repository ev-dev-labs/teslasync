import { Clock3, Database, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@/components/ui/runtime';
import { TIME_MACHINE_OPEN_PICKER_EVENT } from '../../feedback/TimeMachineBanner';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

interface OperationalModeSegmentProps {
  iconOnly?: boolean;
}

export function OperationalModeSegment({
  iconOnly = false,
}: OperationalModeSegmentProps) {
  const { t } = useTranslation();
  const operationalMode = useOperationalMode();
  const config = {
    live: {
      Icon: Clock3,
      tone: 'text-[var(--semantic-success)]',
      dot: 'bg-[var(--semantic-success)]',
    },
    cached: {
      Icon: Database,
      tone: 'text-[var(--semantic-warning)]',
      dot: 'bg-[var(--semantic-warning)]',
    },
    as_of: {
      Icon: History,
      tone: 'text-[var(--semantic-info)]',
      dot: 'bg-[var(--semantic-info)]',
    },
  }[operationalMode.mode];
  const Icon = config.Icon;

  return (
    <Tooltip content={operationalMode.description} side="top" multiline>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={operationalMode.description}
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent(TIME_MACHINE_OPEN_PICKER_EVENT),
          )
        }
        className={cn(
          'h-5 min-h-0 min-w-0 gap-1.5 rounded-shape-sm px-1.5 py-0 leading-none',
          typography.size.xs,
          config.tone,
        )}
      >
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', config.dot)}
          aria-hidden="true"
        />
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {!iconOnly && (
          <span className={cn('min-w-0 max-w-32 truncate', typography.weight.medium)}>
            {operationalMode.mode === 'live'
              ? t('statusBar.mode.now', 'Now')
              : operationalMode.label}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}
