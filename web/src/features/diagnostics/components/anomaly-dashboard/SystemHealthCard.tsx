import { useTranslation } from 'react-i18next';

import { SeverityBadge } from '@/components/data-display';
import { Text } from '@/components/ui';
import { severityTokens } from '@/lib/tokens';
import { cn } from '@/lib/cn';

import { HEALTH_ICONS, HEALTH_FALLBACK_ICON, healthSeverity } from './anomalyHelpers';

interface SystemHealthCardProps {
  category: string;
  status: string;
}

/**
 * One row in the System Health side panel: a category icon, its localized name,
 * and a color-independent {@link SeverityBadge}. The status is derived through
 * `healthSeverity` so 'normal' reads as a green success state.
 */
export function SystemHealthCard({ category, status }: SystemHealthCardProps) {
  const { t } = useTranslation();
  const sev = healthSeverity(status);
  const tone = severityTokens[sev];
  const Icon = HEALTH_ICONS[category] ?? HEALTH_FALLBACK_ICON;

  return (
    <li className={cn('flex items-center gap-3 rounded-xl border p-3', tone.bg, tone.border)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/10">
        <Icon className={cn('h-4 w-4', tone.fg)} aria-hidden="true" />
      </span>
      <Text size="sm" weight="medium" color="primary" className="flex-1 truncate capitalize">
        {t(`anomaly.category.${category}`, category)}
      </Text>
      <SeverityBadge severity={sev} size="sm">
        {t(`anomaly.status.${status}`, status)}
      </SeverityBadge>
    </li>
  );
}
