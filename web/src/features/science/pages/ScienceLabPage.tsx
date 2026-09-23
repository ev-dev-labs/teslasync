import { useTranslation } from 'react-i18next';

import { DataProvenanceBadge } from '@/components/data-display';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ElectrochemPanel,
  NotebookPanel,
  ThermalPanel,
  TiresPanel,
  WeatherPanel,
} from '@/features/science/components/SciencePanels';
import { ScienceEvidenceOverview } from '@/features/science/components/ScienceEvidenceOverview';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAnalysisWindow } from '@/hooks/useAnalysisWindow';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateTime } from '@/lib/dateFormat';

type Translate = (key: string, fallback: string, options?: Record<string, unknown>) => string;

const WINDOW_PRESETS = [7, 30] as const;

export default function ScienceLabPage() {
  const { t: translate } = useTranslation();
  const t: Translate = (key, fallback, options) => String(translate(key, fallback, options));
  const { selected: days, window, pickWindow } = useAnalysisWindow('days', WINDOW_PRESETS, 7);

  const title = t('science.title', 'Science Lab');
  usePageTitle(title);
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={title} />;
  }

  const scope = { vehicleId: vehicleIdStr, start: window.start, end: window.end };

  return (
    <PageContainer
      title={title}
      subtitle={t('science.subtitle', 'Every claim is a fit: n, uncertainty, firmware epoch, holdout.')}
      copyLink
      contextActions={(
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <DataProvenanceBadge provenance="historical" />
          <VehicleSelect />
        </div>
      )}
    >
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('science.window.label', 'Window')}>
        {WINDOW_PRESETS.map((preset) => (
          <Button
            key={preset}
            variant={preset === days ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => { pickWindow(preset); }}
            aria-pressed={preset === days}
          >
            {t('science.window.days', 'Last {{days}}d', { days: preset })}
          </Button>
        ))}
        <Text as="span" size="sm" color="secondary">
          {formatDateTime(window.start)} → {formatDateTime(window.end)}
        </Text>
      </div>

      <div className="space-y-6">
        <ScienceEvidenceOverview window={scope} />
        <section id="science-electrochem" className="scroll-mt-24"><ElectrochemPanel window={scope} /></section>
        <section id="science-thermal" className="scroll-mt-24"><ThermalPanel window={scope} /></section>
        <section id="science-weather" className="scroll-mt-24"><WeatherPanel window={scope} /></section>
        <section id="science-tires" className="scroll-mt-24"><TiresPanel window={scope} /></section>
        <section id="science-notebook" className="scroll-mt-24"><NotebookPanel window={scope} /></section>
      </div>
    </PageContainer>
  );
}
