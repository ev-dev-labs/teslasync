import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceElectrochem,
  useScienceNotebook,
  useScienceThermal,
  useScienceTires,
  useScienceWeather,
} from '@/api/hooks/useScience';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { fmtNumber } from '@/lib/numberFormat';
import { asList, useT } from './helpers';

export function ScienceEvidenceOverview({ window }: { window: ScienceWindow }) {
  const t = useT();
  const electrochem = useDataState(useScienceElectrochem(window), { provenance: 'historical' });
  const thermal = useDataState(useScienceThermal(window), { provenance: 'historical' });
  const weather = useDataState(useScienceWeather(window), { provenance: 'historical' });
  const tires = useDataState(useScienceTires(window), { provenance: 'historical' });
  const notebook = useDataState(useScienceNotebook(window), { provenance: 'historical' });

  const restCount = asList(electrochem.data?.ocv_points).length;
  const irCount = asList(electrochem.data?.ir_points).length;
  const thermalCount = asList(thermal.data?.fits).filter((fit) => !fit.unknown).length;
  const weatherCount = asList(weather.data?.points).length;
  const corners = [
    tires.data?.fl_kpa, tires.data?.fr_kpa, tires.data?.rl_kpa, tires.data?.rr_kpa,
  ].filter((value) => value != null).length;
  const entries = asList(notebook.data?.entries);
  const qualifiedEntries = entries.filter((entry) => !entry.unknown).length;

  const cards = [
    {
      id: 'science-electrochem',
      title: t('science.overview.battery', 'Battery evidence'),
      state: electrochem,
      hasEvidence: restCount > 0 || irCount > 0,
      measure: t('science.overview.batteryMeasure', '{{rest}} rest points · {{ir}} resistance steps', {
        rest: fmtNumber(restCount, 0), ir: fmtNumber(irCount, 0),
      }),
      meaning: electrochem.data?.capacity_proxy_unknown
        ? t('science.overview.batteryUnknown', 'Capacity proxy unavailable; this is not a battery health score.')
        : t('science.overview.batteryMeaning', 'Rest voltage and pack resistance are proxies, not cell diagnostics.'),
    },
    {
      id: 'science-thermal',
      title: t('science.overview.thermal', 'Thermal fits'),
      state: thermal,
      hasEvidence: thermalCount > 0,
      measure: t('science.overview.thermalMeasure', '{{count}} qualified cooldown fits', { count: fmtNumber(thermalCount, 0) }),
      meaning: t('science.overview.thermalMeaning', 'Only observed Park cooldowns qualify; inspect uncertainty below.'),
    },
    {
      id: 'science-weather',
      title: t('science.overview.weather', 'Weather matches'),
      state: weather,
      hasEvidence: weatherCount > 0 && !weather.data?.weather_unknown,
      measure: t('science.overview.weatherMeasure', '{{count}} drives joined to archive weather', { count: fmtNumber(weatherCount, 0) }),
      meaning: t('science.overview.weatherMeaning', 'Associations with energy residuals do not establish causation.'),
    },
    {
      id: 'science-tires',
      title: t('science.overview.tires', 'Tire evidence'),
      state: tires,
      hasEvidence: corners > 0 && !tires.data?.unknown,
      measure: t('science.overview.tiresMeasure', '{{count}} of 4 corners reported', { count: corners }),
      meaning: t('science.overview.tiresMeaning', 'Extra rolling energy is model sensitivity, not measured loss.'),
    },
    {
      id: 'science-notebook',
      title: t('science.overview.notebook', 'Analysis records'),
      state: notebook,
      hasEvidence: qualifiedEntries > 0,
      measure: t('science.overview.notebookMeasure', '{{qualified}} of {{total}} rows with a result', {
        qualified: qualifiedEntries, total: entries.length,
      }),
      meaning: t('science.overview.notebookMeaning', 'Generated analyses; inspect methods and missing signals below.'),
    },
  ];

  return (
    <GlassPanel padding="auto" className="space-y-4" data-testid="science-overview">
      <div className="space-y-1">
        <PanelTitle>{t('science.overview.title', 'Evidence at a glance')}</PanelTitle>
        <Text as="p" size="sm" color="secondary">
          {t('science.overview.subtitle', 'What this vehicle actually contributed in the selected window. Counts are observations, not a health grade.')}
        </Text>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const unavailable = card.state.fatalError != null;
          const loading = card.state.status === 'initial';
          const stateLabel = unavailable
            ? t('science.overview.failed', 'Unavailable')
            : loading
              ? t('science.overview.loading', 'Loading')
              : card.state.refreshError
                ? t('science.overview.cached', 'Cached · refresh failed')
                : card.hasEvidence
                  ? t('science.overview.available', 'Evidence available')
                  : t('science.overview.limited', 'Limited evidence');
          return (
            <div key={card.id} className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Text as="span" size="sm" color="primary" className="font-semibold">{card.title}</Text>
                <Badge variant={unavailable || loading || !!card.state.refreshError || !card.hasEvidence ? 'warning' : 'success'} size="sm">{stateLabel}</Badge>
              </div>
              <Text as="p" size="sm" color="primary" className="tabular-nums">
                {loading || unavailable
                  ? t('science.overview.noCount', 'Awaiting a successful report')
                  : card.measure}
              </Text>
              <Text as="p" size="sm" color="secondary">{card.meaning}</Text>
              <a href={`#${card.id}`} className="inline-block text-sm text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--text-primary)]">
                {t('science.overview.inspect', 'Inspect evidence')}
              </a>
            </div>
          );
        })}
      </div>
    </GlassPanel>
  );
}
