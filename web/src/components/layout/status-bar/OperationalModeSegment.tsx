import { Database, History, Radio } from 'lucide-react';
import { Button, Tooltip } from '@/components/ui/runtime';
import { TIME_MACHINE_OPEN_PICKER_EVENT } from '@/components/feedback';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { cn } from '@/lib/cn';

interface OperationalModeSegmentProps {
  iconOnly?: boolean;
}

export function OperationalModeSegment({
  iconOnly = false,
}: OperationalModeSegmentProps) {
  const operationalMode = useOperationalMode();
  const config = {
    live: {
      Icon: Radio,
      tone: 'text-emerald-300',
      dot: 'bg-emerald-400',
    },
    cached: {
      Icon: Database,
      tone: 'text-amber-300',
      dot: 'bg-amber-400',
    },
    as_of: {
      Icon: History,
      tone: 'text-sky-300',
      dot: 'bg-sky-400',
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
          'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 text-xs leading-none',
          config.tone,
        )}
      >
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', config.dot)}
          aria-hidden="true"
        />
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        {!iconOnly && (
          <span className="max-w-32 truncate font-medium">
            {operationalMode.label}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}
