import { Plug, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge, Caption } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface ChargeStatusSummaryProps {
  charging: boolean | null | undefined;
  active: boolean;
  limit: number | null | undefined;
}

export function ChargeStatusSummary({ charging, active, limit }: ChargeStatusSummaryProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber } = useNumberFormatting();
  const hasLimit = limit != null && Number.isFinite(limit) && limit >= 0 && limit <= 100;
  const Icon = charging === true ? Zap : Plug;
  return (
    <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Badge variant={active ? 'success' : 'neutral'} size="sm">
        <Icon className="mr-1 size-3.5 shrink-0" aria-hidden="true" />
        {charging === true ? t('widget.charging', 'Charging')
          : charging === false ? t('widget.notCharging', 'Not charging')
            : t('widget.chargingSchedule.modeUnknown', 'Unknown')}
      </Badge>
      {charging === true && !active && (
        <Caption>{t('widget.chargeStatus.lastReported', 'Last reported')}</Caption>
      )}
      <Caption>
        {t('widget.chargeStatus.chargeLimit', 'Charge limit')}{' '}
        {hasLimit ? `${fmtNumber(limit, 0)}%` : '—'}
      </Caption>
    </div>
  );
}
