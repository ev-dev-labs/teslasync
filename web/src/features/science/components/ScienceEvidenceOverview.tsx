import type { ScienceWindow } from '@/api/hooks/useScience';
import {
  useScienceElectrochem,
  useScienceNotebook,
  useScienceThermal,
  useScienceTires,
  useScienceWeather,
} from '@/api/hooks/useScience';
import { Badge } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { useDataState } from '@/hooks/useDataState';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { formatDateTime } from '@/lib/dateFormat';

import { asList, useT } from './helpers';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { ScienceSummaryBrief } from './operationalbrief-all/ScienceSummaryBrief';

export function ScienceEvidenceOverview({ window }: { window: ScienceWindow }) {
  const { fmtInt } = useNumberFormatting();
  const t = useT();
  const electrochemQuery = useScienceElectrochem(window);
  const thermalQuery = useScienceThermal(window);
  const weatherQuery = useScienceWeather(window);
  const tiresQuery = useScienceTires(window);
  const notebookQuery = useScienceNotebook(window);
  const electrochem = useDataState(electrochemQuery, { provenance: 'historical' });
  const thermal = useDataState(thermalQuery, { provenance: 'historical' });
  const weather = useDataState(weatherQuery, { provenance: 'historical' });
  const tires = useDataState(tiresQuery, { provenance: 'historical' });
  const notebook = useDataState(notebookQuery, { provenance: 'historical' });

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
      rawValue: electrochem.data ? restCount : null,
      resolvedEmpty: electrochemQuery.isSuccess && electrochemQuery.data == null,
      measure: t('science.overview.batteryMeasure', '{{rest}} rest points · {{ir}} resistance steps', {
        rest: fmtInt(restCount), ir: fmtInt(irCount),
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
      rawValue: thermal.data ? thermalCount : null,
      resolvedEmpty: thermalQuery.isSuccess && thermalQuery.data == null,
      measure: t('science.overview.thermalMeasure', '{{count}} qualified cooldown fits', { count: fmtInt(thermalCount) }),
      meaning: t('science.overview.thermalMeaning', 'Only observed park cooldowns qualify; inspect uncertainty below.'),
    },
    {
      id: 'science-weather',
      title: t('science.overview.weather', 'Weather matches'),
      state: weather,
      hasEvidence: weatherCount > 0 && !weather.data?.weather_unknown,
      rawValue: weather.data ? weatherCount : null,
      resolvedEmpty: weatherQuery.isSuccess && weatherQuery.data == null,
      measure: t('science.overview.weatherMeasure', '{{count}} drives joined to archive weather', { count: fmtInt(weatherCount) }),
      meaning: t('science.overview.weatherMeaning', 'Associations with energy residuals do not establish causation.'),
    },
    {
      id: 'science-tires',
      title: t('science.overview.tires', 'Tire evidence'),
      state: tires,
      hasEvidence: corners > 0 && !tires.data?.unknown,
      rawValue: tires.data ? corners : null,
      resolvedEmpty: tiresQuery.isSuccess && tiresQuery.data == null,
      measure: t('science.overview.tiresMeasure', '{{count}} of 4 corners reported', { count: corners }),
      meaning: t('science.overview.tiresMeaning', 'Extra rolling energy is model sensitivity, not measured loss.'),
    },
    {
      id: 'science-notebook',
      title: t('science.overview.notebook', 'Analysis records'),
      state: notebook,
      hasEvidence: qualifiedEntries > 0,
      rawValue: notebook.data ? qualifiedEntries : null,
      resolvedEmpty: notebookQuery.isSuccess && notebookQuery.data == null,
      measure: t('science.overview.notebookMeasure', '{{qualified}} of {{total}} rows with a result', {
        qualified: qualifiedEntries, total: entries.length,
      }),
      meaning: t('science.overview.notebookMeaning', 'Generated analyses; inspect methods and missing signals below.'),
    },
  ];
  const sourceMetrics: StatMetric[] = cards.map((card) => {
    const unavailable = card.state.fatalError != null;
    const loading = card.state.status === 'initial' && !card.resolvedEmpty;
    const stateLabel = unavailable
      ? t('science.overview.failed', 'Unavailable')
      : loading
        ? t('science.overview.loading', 'Loading')
        : card.state.refreshError
          ? t('science.overview.cached', 'Cached · refresh failed')
          : card.state.isRefreshBlocked
            ? t('science.brief.offline', 'Cached · refresh paused')
            : card.state.status === 'stale'
              ? t('science.brief.stale', 'Retained report')
              : card.hasEvidence
                ? t('science.overview.available', 'Evidence available')
                : t('science.overview.limited', 'Limited evidence');
    const report = card.state.data;
    return {
      metricId: 'count',
      occurrenceId: card.id,
      label: card.id === 'science-electrochem' ? t('science.electrochem.restPoints', 'rest points') : card.title,
      rawValue: card.rawValue,
      description: card.meaning,
      missingReason: t('science.overview.noCount', 'Awaiting a successful report'),
      context: (
        <div className="space-y-1">
          {card.id === 'science-electrochem' && <div>{card.title}</div>}
          <Badge variant={unavailable || loading || !!card.state.refreshError || card.state.isRefreshBlocked || card.state.status === 'stale' || !card.hasEvidence ? 'warning' : 'info'} size="sm">{stateLabel}</Badge>
          <div>{card.rawValue == null ? t('science.overview.noCount', 'Awaiting a successful report') : card.measure}</div>
          {report && <div>{formatDateTime(report.start)} → {formatDateTime(report.end)}</div>}
          {report && <div>{report.honesty}</div>}
          {card.state.updatedAt != null && <div>{t('science.brief.loaded', 'Report loaded {{at}}', { at: formatDateTime(new Date(card.state.updatedAt)) })}</div>}
          <a href={`#${card.id}`} className="inline-block underline underline-offset-4">
            {t('science.overview.inspect', 'Inspect evidence')}
          </a>
        </div>
      ),
    };
  });
  sourceMetrics.splice(1, 0, {
    metricId: 'count',
    occurrenceId: 'science-resistance-steps',
    label: t('science.overview.resistance', 'Resistance steps'),
    rawValue: electrochem.data ? irCount : null,
    description: t('science.overview.batteryMeaning', 'Rest voltage and pack resistance are proxies, not cell diagnostics.'),
    context: electrochem.data?.honesty,
    missingReason: t('science.overview.noCount', 'Awaiting a successful report'),
  });

  return (
    <section data-testid="science-overview" className="min-w-0">
      <LayoutCard
        title={t('science.overview.title', 'Evidence at a glance')}
        description={t('science.overview.subtitle', 'What this vehicle actually contributed in the selected window. Counts are observations, not a health grade.')}
      >
      <ScienceSummaryBrief
        title={t('science.overview.title', 'Evidence at a glance')}
        description={t('science.overview.subtitle', 'What this vehicle actually contributed in the selected window. Counts are observations, not a health grade.')}
        metrics={sourceMetrics}
        states={[electrochem, thermal, weather, tires, notebook]}
        window={window}
        limited={cards.some((card) => !card.hasEvidence)}
        testId="science-evidence-brief"
      />
      </LayoutCard>
    </section>
  );
}
