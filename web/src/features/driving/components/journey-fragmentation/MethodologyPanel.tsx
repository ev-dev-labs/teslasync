import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, Text } from '@/components/ui';

import { JourneyFragmentationSectionProps } from './_types';

export function MethodologyPanel({ result }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="space-y-3 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
        <div>
          <Text as="h2" variant="panelTitle">{t('journeyFragmentation.method.title', 'Methodology and interpretation limits')}</Text>
          <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.method.subtitle', 'A frozen, vehicle-local analysis of one returned history window.')}</Text>
        </div>
      </div>
      <ul className="space-y-2 pl-5 text-sm text-[var(--text-secondary)]">
        <li>{t('journeyFragmentation.method.sequence', 'Records are stably sorted by start time inside source-order segments; an unparseable start creates a local boundary.')}</li>
        <li>{t('journeyFragmentation.method.continuity', 'A linked pair needs adjacent included records, non-overlapping timestamps, matching normalized addresses or GPS within {{meters}} m, and a gap at or below {{minutes}} minutes.', { meters: result.options.gpsToleranceM, minutes: result.options.maxParkingGapMin })}</li>
        <li>{t('journeyFragmentation.method.invariant', 'Each included drive belongs to one observed journey, so journey count equals included drives minus linked pairs.')}</li>
        <li>{t('journeyFragmentation.method.energy', 'Energy intensity uses complete-energy journeys only and is reported in canonical Wh/m before display-unit formatting; coverage and support remain visible.')}</li>
        <li>{t('journeyFragmentation.method.clock', 'The analysis clock is fixed at page load and calendar profiles use the vehicle IANA timezone: {{timeZone}}.', { timeZone: result.timeZone })}</li>
        <li>{t('journeyFragmentation.method.scope', 'Returned history is capped at {{limit}} rows and is not a claim about lifetime history. Structural indicators and observed energy-intensity differences do not establish intent or causality.', { limit: result.historyLimit })}</li>
      </ul>
    </GlassPanel>
  );
}
