import { ListTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { PreconditioningDepartureCard } from './PreconditioningDepartureCard';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type {
  PreconditioningQueryState,
  TemperatureDeltaFormatter,
} from './types';

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
  const { t } = useTranslation();
  const directory = summary.directory;

  return (
    <section data-testid="preconditioning-departure-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListTree className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.directory.title',
            'Departure evidence directory',
          )}
        </PanelTitle>
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
      </GlassPanel>
    </section>
  );
}
