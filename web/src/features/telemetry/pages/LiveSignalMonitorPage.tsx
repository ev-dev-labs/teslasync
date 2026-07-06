/**
 * LiveSignalMonitorPage — full-width, real-time command center for the Tesla
 * Fleet Telemetry firehose.
 *
 * A single `useLiveSignalStream` SSE subscription feeds the whole page (the
 * same hook + `LiveSignalTail` the unified `/signals` workspace uses, so
 * behaviour stays identical with zero duplication). On top of the raw tail we
 * derive — honestly, from the live 500-entry buffer — a KPI band, a throughput
 * chart, a value-type breakdown, and a most-active-signals ranking, laid out as
 * a responsive bento that reflows to more columns on wide monitors.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { WifiOff } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Badge } from '@/components/ui';
import { AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { VehicleSelect } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import { LiveSignalTail } from '../components/LiveSignalTail';
import { LiveMonitorKpiBand } from '../components/LiveMonitorKpiBand';
import { LiveThroughputPanel } from '../components/LiveThroughputPanel';
import { SignalTypeBreakdown } from '../components/SignalTypeBreakdown';
import { TopSignalsPanel, type TopSignal } from '../components/TopSignalsPanel';
import { useLiveSignalStream } from '../hooks/useLiveSignalStream';
import { useThroughputHistory } from '../hooks/useThroughputHistory';

const TAIL_MAX = 500;
const TOP_SIGNAL_COUNT = 12;

interface LiveAnalytics {
  uniqueSignals: number;
  numericCount: number;
  booleanCount: number;
  stringCount: number;
  topSignals: TopSignal[];
}

export default function LiveSignalMonitorPage() {
  const { t } = useTranslation();
  usePageTitle(t('liveMonitor.title', 'Live Monitor'));

  const { vehicleId } = useSelectedVehicle();

  const live = useLiveSignalStream({
    enabled: true,
    vehicleId: vehicleId ?? null,
    chartSignals: [],
    tailMax: TAIL_MAX,
  });

  const throughput = useThroughputHistory(live.tailRate, {
    enabled: true,
    resetKey: vehicleId ?? null,
  });

  // Derive summary analytics from the live tail buffer. The tail is prepended
  // newest-first, so the FIRST time a name is seen carries its latest value.
  const analytics = useMemo<LiveAnalytics>(() => {
    const entries = live.tailEntries ?? [];
    let numericCount = 0;
    let booleanCount = 0;
    let stringCount = 0;
    const byName = new Map<string, TopSignal>();

    for (const entry of entries) {
      if (entry.type === 'number') numericCount += 1;
      else if (entry.type === 'boolean') booleanCount += 1;
      else stringCount += 1;

      const existing = byName.get(entry.name);
      if (existing) {
        existing.count += 1;
      } else {
        byName.set(entry.name, {
          name: entry.name,
          count: 1,
          value: entry.value ?? '—',
          type: entry.type,
        });
      }
    }

    const topSignals = Array.from(byName.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_SIGNAL_COUNT);

    return {
      uniqueSignals: byName.size,
      numericCount,
      booleanCount,
      stringCount,
      topSignals,
    };
  }, [live.tailEntries]);

  const bufferCount = live.tailEntries?.length ?? 0;
  const connectionBadge = (
    <Badge variant={live.connected ? 'success' : 'danger'} dot>
      {live.connected
        ? t('liveMonitor.connected', 'Connected')
        : t('liveMonitor.disconnected', 'Disconnected')}
    </Badge>
  );

  return (
    <PageContainer
      title={t('liveMonitor.title', 'Live Monitor')}
      subtitle={t('liveMonitor.subtitle', 'Real-time scrolling view of incoming vehicle signals')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <VehicleSelect />
          {connectionBadge}
        </div>
      }
    >
      {!live.connected && (
        <AlertBanner variant="warning" icon={<WifiOff className="h-5 w-5" aria-hidden="true" />}>
          {t(
            'liveMonitor.disconnectedBanner',
            'Live stream disconnected — attempting to reconnect. Figures below reflect the last buffered signals.',
          )}
        </AlertBanner>
      )}

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <LiveMonitorKpiBand
          connected={live.connected}
          rate={live.tailRate}
          bufferCount={bufferCount}
          bufferMax={TAIL_MAX}
          uniqueSignals={analytics.uniqueSignals}
          numericCount={analytics.numericCount}
          categoricalCount={analytics.booleanCount + analytics.stringCount}
        />
      </FadeIn>

      {/* 2 — Live analytics bento: hero throughput chart + type breakdown */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('liveMonitor.analytics', 'Live analytics')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <LiveThroughputPanel
            className="xl:col-span-2"
            history={throughput.history}
            rate={live.tailRate}
            peak={throughput.peak}
            connected={live.connected}
          />
          <SignalTypeBreakdown
            className="xl:col-span-1"
            numericCount={analytics.numericCount}
            booleanCount={analytics.booleanCount}
            stringCount={analytics.stringCount}
          />
        </section>
      </FadeIn>

      {/* 3 — Most active signals: full-width multi-column bar grid */}
      <FadeIn delay={0.2}>
        <TopSignalsPanel signals={analytics.topSignals} />
      </FadeIn>

      {/* 4 — Detail band: the live scrolling tail (self-wrapped in FadeIn) */}
      <LiveSignalTail
        entries={live.tailEntries}
        rate={live.tailRate}
        paused={live.tailPaused}
        onPauseToggle={() => live.setTailPaused((p: boolean) => !p)}
        onClear={live.clearTail}
        bufferMax={TAIL_MAX}
        showStats={false}
        title={t('liveMonitor.tailTitle', 'Live Signal Tail')}
        headerExtra={connectionBadge}
      />
    </PageContainer>
  );
}
