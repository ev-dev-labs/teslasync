import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock } from 'lucide-react';

import { GlassPanel, IconBox, Text } from '@/components/ui';
import { Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { type NeonColor } from '@/lib/tokens';
import { VisuallyHidden } from '@/components/a11y';

/**
 * A single onboarding anchor status card.
 *
 * Renders one of the three setup anchors (Tesla account, vehicles,
 * telemetry) as a compact KPI-style tile: domain icon, the current
 * value, and a short hint. Status is conveyed with BOTH an icon shape
 * (check vs clock) and text so it never depends on colour alone.
 */
export interface OnboardingStatusCardProps {
  /** Domain icon rendered in the coloured IconBox. */
  icon: ReactNode;
  /** Accent colour for the IconBox. */
  color: NeonColor;
  /** Uppercase metric label (already localized). */
  label: string;
  /** Prominent value / status word (already localized). */
  value: string;
  /** Whether the underlying anchor is satisfied. */
  done: boolean;
  /** Supporting one-line hint (already localized). */
  hint: string;
  /** Show a skeleton while the status query is loading. */
  loading?: boolean;
  className?: string;
}

export function OnboardingStatusCard({
  icon,
  color,
  label,
  value,
  done,
  hint,
  loading = false,
  className,
}: OnboardingStatusCardProps) {
  const { t } = useTranslation();
  const StatusIcon = done ? Check : Clock;

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)} aria-busy={loading}>
      {loading ? (
        <div className="space-y-2" role="status">
          <VisuallyHidden>
            {t('onboarding.status.loading', 'Loading status…')}
          </VisuallyHidden>
          <Skeleton width="55%" height={12} />
          <Skeleton width="70%" height={24} />
          <Skeleton width="45%" height={12} />
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Text variant="metricLabel" as="p" className="truncate">
              {label}
            </Text>
            <div className="mt-1.5 flex items-center gap-1.5">
              <StatusIcon
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 shrink-0',
                  done ? 'text-emerald-300' : 'text-amber-300',
                )}
              />
              <Text as="span" size="lg" weight="semibold" color="primary" className="truncate">
                {value}
              </Text>
            </div>
            <Text variant="caption" as="p" className="mt-1 line-clamp-2">
              {hint}
            </Text>
          </div>
          <IconBox color={color} size="md">
            {icon}
          </IconBox>
        </div>
      )}
    </GlassPanel>
  );
}
