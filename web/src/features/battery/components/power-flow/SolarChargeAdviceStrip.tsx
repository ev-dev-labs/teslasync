import { useTranslation } from 'react-i18next';
import { Sun, PlugZap } from 'lucide-react';

import { Badge, Text } from '@/components/ui';
import { useSolarChargeAdvice } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';

interface SolarChargeAdviceStripProps {
  siteId?: number;
}

function verdictVariant(verdict: string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (verdict) {
    case 'charge_now':
      return 'success';
    case 'charge_soon':
      return 'info';
    case 'wait':
      return 'warning';
    default:
      return 'neutral';
  }
}

/**
 * Solar-surplus car-charging advice strip for the Power Flow status band.
 * Silent while loading or without a site — the live-status strip already
 * covers those states.
 */
export function SolarChargeAdviceStrip({ siteId }: SolarChargeAdviceStripProps) {
  const { t } = useTranslation();
  const { data } = useSolarChargeAdvice(siteId);

  if (!data || data.verdict === 'no_data') return null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="status" aria-label={t('powerFlow.solarAdvice', 'Solar charging advice')}>
      <Badge variant={verdictVariant(data.verdict)}>
        {data.verdict === 'charge_now' ? (
          <PlugZap className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Sun className="h-3 w-3" aria-hidden="true" />
        )}
        {data.verdict === 'charge_now'
          ? t('powerFlow.chargeNow', 'Charge now on solar')
          : data.verdict === 'charge_soon'
            ? t('powerFlow.chargeSoon', 'Charge soon')
            : t('powerFlow.chargeWait', 'Hold for cheap rates')}
      </Badge>
      <Text as="span" variant="caption" className="tabular-nums">
        {t('powerFlow.surplus', '{{kw}} kW surplus · ~{{amps}}A solar-matched', {
          kw: fmtNumber(data.surplus_w / 1000, 1),
          amps: data.recommended_amps,
        })}
      </Text>
    </div>
  );
}
