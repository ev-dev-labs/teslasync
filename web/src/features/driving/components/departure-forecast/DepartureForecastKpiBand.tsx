import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import type { DepartureForecast } from '../../lib/departureForecast';
import { DepartureForecastKpiCards } from './DepartureForecastKpiCards';
import { DepartureForecastQueryStatus } from './DepartureForecastQueryStatus';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastKpiBandProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
  timeZone: string;
}

export function DepartureForecastKpiBand({
  forecast,
  state,
  locale,
  timeZone,
}: DepartureForecastKpiBandProps) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t(
        'departure.kpis.aria',
        'Departure forecast evidence summary',
      )}
      data-testid="departure-kpis"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('departure.kpis.title', 'Forecast evidence')}
        </PanelTitle>
        <DepartureForecastKpiCards
          forecast={forecast}
          state={state}
          locale={locale}
          timeZone={timeZone}
        />
        <DepartureForecastQueryStatus forecast={forecast} state={state} />
      </GlassPanel>
    </section>
  );
}
