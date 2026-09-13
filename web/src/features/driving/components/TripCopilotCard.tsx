import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption, Button, Input, Badge, ErrorText } from '@/components/ui';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useTripConfidence } from '@/api/hooks/useDriving';
import { fmtNumber } from '@/lib/numberFormat';

interface TripCopilotCardProps {
  currentSoc: number;
  minArrivalSoc: number;
}

function verdictBadge(verdict: string, t: (k: string, d: string) => string): { label: string; variant: 'success' | 'warning' | 'danger' } {
  switch (verdict) {
    case 'comfortable':
      return { label: t('tripPlanner.copilot.comfortable', 'You will make it'), variant: 'success' };
    case 'tight':
      return { label: t('tripPlanner.copilot.tight', 'Tight — drive gently'), variant: 'warning' };
    default:
      return { label: t('tripPlanner.copilot.chargeNow', 'Charge first'), variant: 'danger' };
  }
}

/**
 * Trip Copilot: en-route "will I make it" check. Enter the remaining
 * distance; the verdict blends current SOC, efficiency, and arrival floor.
 */
export function TripCopilotCard({ currentSoc, minArrivalSoc }: TripCopilotCardProps) {
  const { t } = useTranslation();
  const [remainingKm, setRemainingKm] = useState('');
  const check = useTripConfidence();
  const result = check.data ?? null;

  const km = Number(remainingKm);
  const canCheck = Number.isFinite(km) && km > 0 && !check.isPending;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('tripPlanner.copilot.title', 'Trip Copilot')}
        </PanelTitle>
        {result && (
          <Badge variant={verdictBadge(result.verdict, t).variant} size="sm">
            {verdictBadge(result.verdict, t).label}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <Input
            label={t('tripPlanner.copilot.remainingKm', 'Remaining (km)')}
            type="number"
            min={1}
            value={remainingKm}
            onChange={(e) => setRemainingKm(e.target.value)}
          />
        </div>
        <Button onClick={() => check.mutate({ current_soc: currentSoc, remaining_km: km, min_arrival_soc: minArrivalSoc })} disabled={!canCheck} loading={check.isPending}>
          {t('tripPlanner.copilot.check', 'Will I make it?')}
        </Button>
      </div>

      <div className="mt-3">
        {check.isPending ? (
          <Skeleton height={64} />
        ) : check.isError ? (
          <ErrorText>{(check.error as Error)?.message || t('tripPlanner.copilot.error', 'Confidence check failed')}</ErrorText>
        ) : !result ? (
          <EmptyState
            icon={<Gauge className="h-8 w-8" />}
            message={t('tripPlanner.copilot.empty', 'Enter remaining distance for a live arrival verdict.')}
          />
        ) : (
          <div className="space-y-1.5">
            <Text as="p" variant="bodySm">{result.explanation}</Text>
            <Caption className="block tabular-nums">
              {t('tripPlanner.copilot.detail', 'Arrival ~{{soc}}% · {{margin}} kWh margin', {
                soc: fmtNumber(result.arrival_soc, 0),
                margin: fmtNumber(result.margin_kwh, 1),
              })}
            </Caption>
          </div>
        )}
      </div>
    </GlassPanel>
  );
}
