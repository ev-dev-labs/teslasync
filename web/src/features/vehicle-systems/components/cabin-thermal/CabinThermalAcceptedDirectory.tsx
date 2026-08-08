import { CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalAcceptedDirectoryProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  locale: string;
  formatTemperature: UnitFormatter;
  formatDuration: UnitFormatter;
}

function EventMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="bodySm" className="mt-0.5 font-mono tabular-nums">
        {value}
      </Text>
    </div>
  );
}

export function CabinThermalAcceptedDirectory({
  summary,
  state,
  locale,
  formatTemperature,
  formatDuration,
}: CabinThermalAcceptedDirectoryProps) {
  const { t } = useTranslation();
  const events = [...summary.events].reverse().slice(0, 20);
  const omitted = summary.events.length - events.length;

  return (
    <section data-testid="cabin-thermal-accepted-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CheckCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.accepted.title', 'Accepted-event directory')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.accepted.subtitle',
            'Newest accepted fits only; showing {{shown}} with {{omitted}} older accepted fits omitted.',
            { shown: fmtInt(events.length), omitted: fmtInt(omitted) },
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="accepted">
          <ol className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
            {events.map((event, index) => (
              <li key={`${event.startTs}-${index}`} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Text as="p" variant="label">{formatDateTime(event.startTs, { locale })}</Text>
                  <Badge variant="success">
                    {event.cooling
                      ? t('cabinThermal.direction.cooling', 'Cooling')
                      : t('cabinThermal.direction.warming', 'Warming')}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  <EventMetric label={t('cabinThermal.accepted.samples', 'Samples')} value={fmtInt(event.samples)} />
                  <EventMetric label={t('cabinThermal.accepted.duration', 'Duration')} value={formatDuration(event.durationMin * 60, { precision: 1 })} />
                  <EventMetric label={t('cabinThermal.accepted.start', 'Start cabin')} value={formatTemperature(event.startInsideC, { precision: 1 })} />
                  <EventMetric label={t('cabinThermal.accepted.end', 'End cabin')} value={formatTemperature(event.endInsideC, { precision: 1 })} />
                  <EventMetric label={t('cabinThermal.accepted.tau', 'Fitted τ')} value={formatDuration(event.tauMin * 60, { precision: 1 })} />
                  <EventMetric label={t('cabinThermal.accepted.r2', 'R²')} value={fmtPercent(event.r2 * 100, 1)} />
                </div>
              </li>
            ))}
          </ol>
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}
