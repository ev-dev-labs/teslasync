import { Database, History, Radio } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { cn } from '@/lib/cn';

export interface OperationalModeBadgeProps {
  showLive?: boolean;
  compact?: boolean;
  className?: string;
}

export function OperationalModeBadge({
  showLive = false,
  compact = false,
  className,
}: OperationalModeBadgeProps) {
  const { t } = useTranslation();
  const operationalMode = useOperationalMode();
  if (!showLive && operationalMode.mode === 'live') return null;

  const config = {
    live: {
      Icon: Radio,
      variant: 'success' as const,
      shortLabel: t('operationalMode.live.shortLabel', 'Live'),
    },
    cached: {
      Icon: Database,
      variant: 'warning' as const,
      shortLabel: t('operationalMode.cached.shortLabel', 'Cached'),
    },
    as_of: {
      Icon: History,
      variant: 'info' as const,
      shortLabel: t('operationalMode.asOf.shortLabel', 'As of'),
    },
  }[operationalMode.mode];
  return (
    <Tooltip content={operationalMode.description} multiline>
      <Badge
        variant={config.variant}
        role="status"
        aria-label={operationalMode.description}
        data-operational-mode={operationalMode.mode}
        className={cn('shrink-0 gap-1.5', className)}
      >
        <Icon icon={config.Icon} size="xs" aria-hidden />
        {compact ? config.shortLabel : operationalMode.label}
      </Badge>
    </Tooltip>
  );
}
