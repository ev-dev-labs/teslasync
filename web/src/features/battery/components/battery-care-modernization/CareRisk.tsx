import { Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Badge, MetricLabel, MetricValue, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { chartTokens } from '@/lib/tokens';
import type { CareRiskId, CareScore } from '../../lib/batteryCare';
import { CareSection } from './CareSection';
import { EvidenceBar } from './EvidenceBar';
import type { CareSectionState } from './state';

function riskLabel(id: CareRiskId, fullChargePct: number, t: TFunction) {
  switch (id) {
    case 'highFinish':
      return t('batteryCare.barFull', 'Sessions charged to {{pct}}%+', { pct: fullChargePct });
    case 'deepArrival':
      return t('batteryCare.barDeep', 'Drives arriving below 10%');
    case 'dcEnergy':
      return t('batteryCare.barDc', 'Energy from DC fast charging');
    case 'outsideBand':
      return t('batteryCare.risk.outsideBand', 'Session finishes outside 20–80%');
  }
}

export function CareRisk({ care, state }: { care: CareScore; state: CareSectionState }) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const readyCount = care.riskComponents.filter(component => component.ready).length;
  return (
    <CareSection
      title={t('batteryCare.risk.title', 'Score & risk decomposition')}
      description={t('batteryCare.risk.description', 'Observed index deductions; unavailable components are never assumed to be zero')}
      icon={<Scale className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t('batteryCare.risk.empty', 'Usable session-end, arrival-SoC, and classified-energy samples are needed to decompose the index.')}
      hasData={care.riskComponents.some(component => component.observedShare != null)}
      state={state}
      testId="battery-care-score"
      badge={
        <Badge variant={care.scoreReady ? 'success' : 'warning'} dot>
          {care.scoreReady
            ? t('batteryCare.risk.ready', 'Index calibrated')
            : t('batteryCare.risk.building', 'Building evidence')}
        </Badge>
      }
    >
      <div className="grid min-w-0 gap-4 @xl:grid-cols-[0.7fr_1.3fr]">
        <div className="min-w-0 rounded-xl bg-[var(--surface-2)] p-4">
          <MetricValue>{care.score != null ? fmtInt(care.score) : '—'}</MetricValue>
          <MetricLabel>{t('batteryCare.risk.indexLabel', 'Observed care index / 100')}</MetricLabel>
          <Text as="p" variant="bodySm" className="mt-3">
            {t('batteryCare.risk.componentsReady', '{{ready}} of {{total}} components calibrated', {
              ready: readyCount,
              total: care.riskComponents.length,
            })}
          </Text>
          <Text as="p" variant="caption" className="mt-3">
            {t('batteryCare.risk.disclaimer', 'This descriptive habit index is not a battery-health measurement or a degradation estimate.')}
          </Text>
        </div>
        <div className="min-w-0 space-y-4">
          {care.riskComponents.map((component, index) => (
            <EvidenceBar
              key={component.id}
              label={riskLabel(component.id, care.fullChargePct, t)}
              value={component.penaltyPoints}
              max={component.maxPoints}
              color={chartTokens.series[index]}
              sublabel={component.penaltyPoints != null
                ? t('batteryCare.risk.deduction', '−{{points}} / {{max}} pts', {
                    points: fmtNumber(component.penaltyPoints),
                    max: component.maxPoints,
                  })
                : t('batteryCare.risk.awaiting', 'Not calibrated · {{count}} samples', {
                    count: component.sampleCount,
                  })}
            />
          ))}
        </div>
      </div>
    </CareSection>
  );
}
