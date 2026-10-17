import { Clock3, Database, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@/components/ui/runtime';
import { TIME_MACHINE_OPEN_PICKER_EVENT } from '../../feedback/TimeMachineBanner';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { StatusOverflowRowContent, statusOverflowRowClass } from './StatusOverflowRow';

interface OperationalModeSegmentProps {
  iconOnly?: boolean;
  /** Render as a labelled row inside the More menu. */
  embedded?: boolean;
  onAction?: () => void;
}

export function OperationalModeSegment({
  iconOnly = false,
  embedded = false,
  onAction,
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
  const modeLabel = operationalMode.mode === 'live'
    ? t('statusBar.mode.now', 'Now')
    : operationalMode.label;
  const openPicker = () =>
    window.dispatchEvent(new CustomEvent(TIME_MACHINE_OPEN_PICKER_EVENT));

  if (embedded) {
    return (
      <button
        type="button"
        aria-label={operationalMode.description}
        onClick={() => {
          onAction?.();
          openPicker();
        }}
        className={statusOverflowRowClass}
      >
        <StatusOverflowRowContent
          dotClassName={config.dot}
          icon={<Icon className={cn('h-4 w-4', config.tone)} aria-hidden="true" />}
          label={t('statusBar.mode.title', 'Data time')}
          value={modeLabel}
          valueClassName={config.tone}
        />
      </button>
    );
  }

  return (
    <Tooltip content={operationalMode.description} side="top" multiline>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={operationalMode.description}
        onClick={openPicker}
        className={cn(
          'h-11 min-h-11 min-w-11 shrink-0 gap-1.5 whitespace-nowrap rounded-shape-sm px-1.5 py-0 leading-none xl:h-5 xl:min-h-0 xl:min-w-0',
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
          <span className={cn('max-w-32 truncate', typography.weight.medium)}>
            {modeLabel}
          </span>
        )}
      </Button>
    </Tooltip>
  );
}
