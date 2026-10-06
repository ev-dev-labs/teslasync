import { LayoutCard } from '@/components/layout';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { TemperatureUnitPref } from '@/lib/unitConversion';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalCandidateRow } from './CabinThermalCandidateRow';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface CabinThermalCandidateDirectoryProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  locale: string;
  temperatureUnit: TemperatureUnitPref;
  formatTemperature: UnitFormatter;
  formatDuration: UnitFormatter;
}

export function CabinThermalCandidateDirectory({
  summary,
  state,
  locale,
  temperatureUnit,
  formatTemperature,
  formatDuration,
}: CabinThermalCandidateDirectoryProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const directory = summary.candidateDirectory;

  return (
    <section data-testid="cabin-thermal-candidate-directory">
      <LayoutCard title={t('cabinThermal.directory.title', 'Candidate-window directory')}>
        <Text as="p" variant="caption" className="mb-1">
          {t(
            'cabinThermal.directory.subtitle',
            'Newest first, with inputs, derivable fit values, and one final disposition per candidate.',
          )}
        </Text>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.directory.cap',
            'Showing {{shown}} of {{total}} candidates; {{omitted}} omitted by the {{cap}}-window display cap.',
            {
              shown: fmtInt(directory.displayed),
              total: fmtInt(directory.total),
              omitted: fmtInt(directory.omitted),
              cap: fmtInt(directory.cap),
            },
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="candidates">
          <ol className="max-h-[36rem] space-y-2 overflow-y-auto pr-1">
            {directory.items.map((candidate) => (
              <CabinThermalCandidateRow
                key={candidate.id}
                candidate={candidate}
                locale={locale}
                temperatureUnit={temperatureUnit}
                formatTemperature={formatTemperature}
                formatDuration={formatDuration}
              />
            ))}
          </ol>
        </CabinThermalSectionBody>
      </LayoutCard>
    </section>
  );
}
