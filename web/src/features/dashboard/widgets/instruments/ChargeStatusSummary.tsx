import { useTranslation } from 'react-i18next';
import { Button, Caption, Tooltip } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { cn } from '@/lib/cn';

interface ChargeStatusSummaryProps {
  charging: boolean | null | undefined;
  active: boolean;
  limit: number | null | undefined;
}

export function ChargeStatusSummary({ charging, active, limit }: ChargeStatusSummaryProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const hasLimit = limit != null && Number.isFinite(limit) && limit >= 0 && limit <= 100;
  const status = charging === true ? t('widget.charging', 'Charging')
    : charging === false ? t('widget.notCharging', 'Not charging')
      : t('widget.chargingSchedule.modeUnknown', 'Unknown');
  const lastReported = charging === true && !active ? t('dashboard.chargeStatus.lastReported', 'Last reported') : null;
  return (
    <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Tooltip content={<><span>{status}</span>{lastReported && <span> · <span>{lastReported}</span></span>}</>}>
        <Button variant="ghost" size="sm" className="h-11 w-11 shrink-0 p-0 md:h-6 md:w-8"
          aria-label={lastReported ? `${status} · ${lastReported}` : status}>
          <span
            role="img"
            aria-label={lastReported ? `${status} · ${lastReported}` : status}
            data-charge-indicator={charging === true ? 'charging' : charging === false ? 'idle' : 'unknown'}
            className={cn('inline-flex h-6 w-8 shrink-0 items-center',
              charging === true ? 'text-[var(--semantic-success)]' : 'text-[var(--text-secondary)]')}
          >
            <svg viewBox="0 0 32 20" className="h-5 w-8" aria-hidden="true" focusable="false">
              <rect x="1" y="3" width="26" height="14" rx="3" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="1.5" />
              <path d="M30 8v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              {charging === true ? (
                <path data-charge-bolt d="m16 5-6 6h5l-1 4 6-7h-5z" fill="currentColor" />
              ) : charging === false ? (
                <path d="M7 10h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M12 8a2 2 0 0 1 4 0c0 1.5-2 1.5-2 3m0 2v.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
              {charging === true && active && (
                <path className="widget-state-motion widget-charge-current" d="M5 5h18" fill="none"
                  stroke="currentColor" strokeWidth="1" strokeDasharray="4 20" strokeLinecap="round" />
              )}
            </svg>
          </span>
        </Button>
      </Tooltip>
      <Caption>
        {t('dashboard.chargeStatus.chargeLimit', 'Charge limit')}{' '}
        {hasLimit ? `${fmtNumber(limit, 0)}%` : '—'}
      </Caption>
    </div>
  );
}
