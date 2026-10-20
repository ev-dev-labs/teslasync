import type { TFunction } from 'i18next';
import type { StatMetric, StatPeriod } from '@/components/data-display';

interface WorkspaceSummarySource {
  selected: number;
  pinned: number;
  isLive: boolean;
  isCompare: boolean;
  rate: number;
  connected: boolean;
  locale: string;
}

export function signalsWorkspaceSummary(source: WorkspaceSummarySource, t: TFunction): {
  metrics: StatMetric[];
  period: StatPeriod;
} {
  const snapshot = t('signalsWorkspace.summary.snapshot', 'Current workspace state');
  return {
    period: {
      kind: 'snapshot', observedAt: null, label: snapshot,
      provenance: t('signalsWorkspace.summary.workspaceScope', 'Selection, mode and pins are current workspace state; live rate has its own one-second SSE window.'),
    },
    metrics: [
      {
        metricId: 'count', occurrenceId: 'signals-selected', rawValue: source.selected,
        label: t('signalsWorkspace.selected', 'Selected'), context: snapshot,
        display: { units: { locale: source.locale } },
      },
      {
        metricId: 'status', occurrenceId: 'signals-mode',
        rawValue: source.isCompare ? t('signalsWorkspace.compare', 'Compare')
          : source.isLive ? t('signalsWorkspace.live', 'Live')
            : t('signalsWorkspace.historical', 'Historical'),
        label: t('signalsWorkspace.mode', 'Mode'), context: snapshot,
      },
      {
        metricId: 'rate', occurrenceId: 'signals-live-rate', rawValue: source.isLive ? source.rate : null,
        label: t('signalsWorkspace.liveRate', 'Live rate'),
        display: { precision: 0, unit: '/s', units: { locale: source.locale } },
        context: source.isLive
          ? `${t('signalsWorkspace.summary.liveRateScope', 'Last-second SSE event count')} · ${source.connected
              ? t('liveMonitor.connected', 'Connected') : t('liveMonitor.disconnected', 'Disconnected')}`
          : t('signalsWorkspace.summary.liveInactive', 'Live stream is not active'),
        description: t('signalsWorkspace.summary.liveRateDescription', 'Vehicle-scoped events received in the last second; not the chart’s rolling five-minute window.'),
      },
      {
        metricId: 'count', occurrenceId: 'signals-pinned', rawValue: source.pinned,
        label: t('signalsWorkspace.pinned', 'Pinned signals'), context: snapshot,
        display: { units: { locale: source.locale } },
      },
    ],
  };
}

interface DiffSummarySource {
  changed: number | null;
  visible: number | null;
  pinned: number;
  atA: string;
  atB: string;
}

export function signalsDiffSummary(source: DiffSummarySource, t: TFunction): {
  metrics: StatMetric[];
  period: StatPeriod;
} {
  return {
    period: {
      kind: 'unknown',
      label: t('signalsWorkspace.summary.diffPeriod', 'Two selected snapshots'),
      reason: t('signalsWorkspace.summary.diffScope', 'Changed and visible counts compare the selected A/B snapshots; pins describe current workspace state.'),
    },
    metrics: [
      {
        metricId: 'count', occurrenceId: 'signals-diff-changed', rawValue: source.changed,
        label: t('signalDiff.totalChanged', 'Changed signals'), display: { notation: 'source' },
      },
      {
        metricId: 'count', occurrenceId: 'signals-diff-visible', rawValue: source.visible,
        label: t('signalDiff.visible', 'Visible after filter'), display: { notation: 'source' },
      },
      {
        metricId: 'count', occurrenceId: 'signals-diff-pinned', rawValue: source.pinned,
        label: t('signalDiff.pinnedCount', 'Pinned'),
        context: t('signalsWorkspace.summary.snapshot', 'Current workspace state'),
        display: { notation: 'source' },
      },
      {
        metricId: 'duration', occurrenceId: 'signals-diff-span',
        rawValue: source.atA && source.atB
          ? Math.abs(new Date(source.atB).getTime() - new Date(source.atA).getTime()) / 1000 : null,
        label: t('signalDiff.windowSpan', 'Window span'),
        context: source.atA && source.atB ? `${source.atA} → ${source.atB}` : undefined,
        display: { notation: 'source', units: { duration: 's' } },
      },
    ],
  };
}
