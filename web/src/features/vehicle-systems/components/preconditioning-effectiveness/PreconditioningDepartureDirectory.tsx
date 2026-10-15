import { LayoutCard } from '@/components/layout';
import { useTranslation } from 'react-i18next';

import { Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';

import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningDepartureCard } from './PreconditioningDepartureCard';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type {
  PreconditioningQueryState,
  TemperatureDeltaFormatter,
} from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface PreconditioningDepartureDirectoryProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  locale: string;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

export function PreconditioningDepartureDirectory({
  summary,
  state,
  locale,
  formatDuration,
  formatDelta,
}: PreconditioningDepartureDirectoryProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const directory = summary.directory;

  return (
    <section data-testid="preconditioning-departure-directory">
      <LayoutCard title={t('preconditioningEffectiveness.directory.title', 'Departure evidence directory')}>
        <Text as="p" variant="caption">
          {t(
            'preconditioningEffectiveness.directory.subtitle',
            'Newest first; every unique valid drive retains its terminal disposition and available window diagnostics.',
          )}
        </Text>
        <PreconditioningSectionBody
          summary={summary}
          state={state}
          requirement="directory"
        >
          <Text as="p" variant="caption" className="mb-4 mt-1">
            {t(
              'preconditioningEffectiveness.directory.cap',
              'Showing {{shown}} of {{total}} departures; {{omitted}} omitted by the {{cap}}-departure model cap.',
              {
                shown: fmtInt(directory.displayed),
                total: fmtInt(directory.total),
                omitted: fmtInt(directory.omitted),
                cap: fmtInt(directory.cap),
              },
            )}
          </Text>
          <ol className="max-h-[52rem] space-y-3 overflow-y-auto pr-1">
            {directory.items.map((item) => (
              <PreconditioningDepartureCard
                key={item.driveId}
                item={item}
                locale={locale}
                formatDuration={formatDuration}
                formatDelta={formatDelta}
              />
            ))}
          </ol>
        </PreconditioningSectionBody>
      </LayoutCard>
    </section>
  );
}
