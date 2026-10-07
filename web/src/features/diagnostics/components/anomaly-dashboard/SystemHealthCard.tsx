import { useTranslation } from 'react-i18next';

import { SeverityBadge } from '@/components/data-display';
import { Text } from '@/components/ui';
import { severityTokens } from '@/lib/tokens';
import { cn } from '@/lib/cn';

import { HEALTH_ICONS, HEALTH_FALLBACK_ICON, healthSeverity } from './anomalyHelpers';

interface SystemHealthCardProps {
  category: string | null | undefined;
  status: string | null | undefined;
}

/**
 * One row in the System Health side panel: a category icon, its localized name,
 * and a color-independent {@link SeverityBadge}. The status is derived through
 * `healthSeverity` so 'normal' reads as a green success state, while an
 * info-level or unrecognized status (and a missing/null value) surfaces as a
 * neutral `info` tone rather than a misleading green "all clear".
 */
export function SystemHealthCard({ category, status }: SystemHealthCardProps) {
  const { t } = useTranslation();

  const categoryKey = (category ?? '').trim();
  const statusKey = (status ?? '').trim();

  const sev = healthSeverity(statusKey);
  const tone = severityTokens[sev];
  const Icon = HEALTH_ICONS[categoryKey] ?? HEALTH_FALLBACK_ICON;

  const categoryLabel = categoryKey
    ? t(`anomaly.category.${categoryKey}`, categoryKey)
    : t('anomaly.category.unknown', 'Unknown');
  const statusLabel = statusKey
    ? t(`anomaly.status.${statusKey}`, statusKey)
    : t('anomaly.status.unknown', 'Unknown');

  return (
    <li className={cn('flex items-center gap-3 rounded-xl border p-3', tone.bg, tone.border)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/10">
        <Icon className={cn('h-4 w-4', tone.fg)} aria-hidden="true" />
      </span>
      <Text
        size="sm"
        weight="medium"
        color="primary"
        title={categoryLabel}
        className="flex-1 truncate capitalize"
      >
        {categoryLabel}
      </Text>
      <SeverityBadge severity={sev} size="sm">
        {statusLabel}
      </SeverityBadge>
    </li>
  );
}
