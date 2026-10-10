import { TrendingUp, TrendingDown, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VisuallyHidden } from '@/components/a11y';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { trendFor } from '../weekly-digest/helpers';

interface DigestTrendProps {
  trend: ReturnType<typeof trendFor>;
  /** Hero highlights historically use favorability for their arrow. */
  highlight?: boolean;
}

export function DigestTrend({ trend, highlight = false }: DigestTrendProps) {
  const { t } = useTranslation();
  const Icon = highlight
    ? trend.positive ? TrendingUp : TrendingDown
    : trend.direction === 'up' ? TrendingUp : trend.direction === 'down' ? TrendingDown : ArrowRight;
  const directionLabel = trend.direction === 'up'
    ? t('statCard.trend.increased', 'increased')
    : trend.direction === 'down'
      ? t('statCard.trend.decreased', 'decreased')
      : t('statCard.trend.unchanged', 'no change');
  return (
    <Text
      as="span"
      size="xs"
      weight="medium"
      className={cn(
        'inline-flex items-center gap-1',
        highlight
          ? trend.positive ? 'text-emerald-300' : 'text-rose-300'
          : trend.positive
            ? 'text-emerald-700 dark:text-emerald-300'
            : trend.direction === 'flat'
              ? 'text-[var(--text-muted)]'
              : 'text-rose-700 dark:text-rose-300',
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {!highlight && <VisuallyHidden>{directionLabel}</VisuallyHidden>}
      {trend.value || '—'}
    </Text>
  );
}
