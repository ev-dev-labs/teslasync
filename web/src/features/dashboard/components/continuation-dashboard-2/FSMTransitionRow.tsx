import { useTranslation } from 'react-i18next';
import { TimeStamp } from '@/components/data-display';
import { Badge, Caption } from '@/components/ui';
import { typography } from '@/lib/tokens';

interface FSMTransitionRowProps {
  from: string;
  to: string;
  timestamp: string;
}

export function FSMTransitionRow({ from, to, timestamp }: FSMTransitionRowProps) {
  const { t } = useTranslation('dashboard');
  return (
    <div className="flex min-h-[44px] min-w-0 flex-wrap items-start justify-between gap-2 py-2">
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
        <Badge variant="neutral" className="max-w-full whitespace-normal break-words">
          {t(`widget.fsmDistribution.state.${from}`, from)}
        </Badge>
        <Caption aria-hidden="true">→</Caption>
        <Badge variant="neutral" className="max-w-full whitespace-normal break-words">
          {t(`widget.fsmDistribution.state.${to}`, to)}
        </Badge>
      </div>
      <TimeStamp value={timestamp} className={`${typography.role.caption} max-w-full whitespace-normal break-words tabular-nums`} />
    </div>
  );
}
