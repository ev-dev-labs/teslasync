import type { TFunction } from 'i18next';
import type { StatMetric, StatPeriod } from '@/components/data-display';

interface MqttSummarySource {
  available: boolean;
  vehicles: number;
  signals: number;
  batches: number;
  rate: number;
  observedAt: string | null;
  precision: number;
  locale: string;
}

export function mqttSummary(source: MqttSummarySource, t: TFunction): {
  metrics: StatMetric[];
  period: StatPeriod;
} {
  return {
    period: {
      kind: 'snapshot', observedAt: source.observedAt,
      label: t('mqtt.summary.period', 'Latest broker status snapshot'),
      provenance: t('mqtt.summary.scope', 'Vehicle totals sum the returned broker counters. Signals / sec sums the reported vehicle rates, not the throughput chart’s per-poll deltas.'),
    },
    metrics: [
      {
        metricId: 'count', occurrenceId: 'mqtt-vehicles',
        rawValue: source.available ? source.vehicles : null,
        label: t('mqtt.streamingVehicles', 'Streaming vehicles'),
        display: { notation: 'source' },
      },
      {
        metricId: 'count', occurrenceId: 'mqtt-signals',
        rawValue: source.available ? source.signals : null,
        label: t('mqtt.totalSignals', 'Total signals'),
        display: { units: { locale: source.locale } },
      },
      {
        metricId: 'count', occurrenceId: 'mqtt-batches',
        rawValue: source.available ? source.batches : null,
        label: t('mqtt.totalBatches', 'Total batches'),
        display: { units: { locale: source.locale } },
      },
      {
        metricId: 'rate', occurrenceId: 'mqtt-rate',
        rawValue: source.available ? source.rate : null,
        label: t('mqtt.signalsPerSec', 'Signals / sec'),
        display: { precision: source.precision, units: { locale: source.locale } },
      },
    ],
  };
}
