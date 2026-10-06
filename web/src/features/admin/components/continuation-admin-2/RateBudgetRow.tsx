import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScopeBudget, RateLimitSeverity } from '@/api/types';
import { MetricBar } from '@/components/data-display';
import { Text, Caption } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import { getGlobalLocale } from '@/lib/numberFormat';

const COLOR: Record<RateLimitSeverity, string> = { ok: '#10b981', warn: '#f59e0b', critical: '#ef4444' };
const TONE: Record<RateLimitSeverity, string> = { ok: 'text-emerald-300', warn: 'text-amber-300', critical: 'text-rose-300' };

export function RateBudgetRow({ scope }: { scope: ScopeBudget }) {
  const { t } = useTranslation();
  const { fmtNumber, formatDurationMsLong } = useNumberFormatting();
  const formatValue = (value: number) => scope.unit === 'usd'
    ? formatCurrencyValue(value, 'USD', getGlobalLocale(), 3, { useGrouping: true }) : fmtNumber(value);
  const windowLabel = scope.unit === 'usd' ? t('rateLimitStatus.windowUtcDay', 'UTC day')
    : !scope.window_seconds || scope.window_seconds <= 0 ? t('rateLimitStatus.windowInstant', 'Live snapshot')
      : t('rateLimitStatus.windowSeconds', 'Last {{seconds}}s window', { seconds: scope.window_seconds });
  const resetLabel = useMemo(() => {
    if (!scope.reset_at) return null;
    const ms = new Date(scope.reset_at).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return t(scope.unit === 'usd' ? 'rateLimitStatus.budgetResetIn' : 'rateLimitStatus.resetIn',
      scope.unit === 'usd' ? 'Resets in {{duration}}' : 'Refills in {{duration}}', { duration: formatDurationMsLong(ms) });
  }, [scope.reset_at, scope.unit, t, formatDurationMsLong]);
  return (
    <div data-testid={`rate-limit-row-${scope.id}`} className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <Text variant="bodySm" weight="medium" className="min-w-0 break-words">{scope.name}</Text>
        <Text variant="caption" className={TONE[scope.severity]} data-testid={`rate-limit-severity-${scope.id}`}>{t(`rateLimitStatus.severity.${scope.severity}`, scope.severity)}</Text>
      </div>
      <MetricBar value={scope.current} max={scope.limit > 0 ? scope.limit : 1} color={COLOR[scope.severity]} label={windowLabel}
        sublabel={t('rateLimitStatus.usage', '{{current}} / {{limit}}', { current: formatValue(scope.current), limit: formatValue(scope.limit) })} />
      {(scope.detail || resetLabel) && <div className="flex flex-wrap items-baseline justify-between gap-2 pt-1">
        {scope.detail && <Caption className="max-w-[60ch] break-words">{scope.detail}</Caption>}
        {resetLabel && <Caption>{resetLabel}</Caption>}
      </div>}
    </div>
  );
}
