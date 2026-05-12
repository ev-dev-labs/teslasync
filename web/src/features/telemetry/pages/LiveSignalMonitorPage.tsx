/**
 * LiveSignalMonitorPage — thin wrapper over the shared `LiveSignalTail`
 * + `useLiveSignalStream`.
 *
 * The historical page used to re-implement the full SSE → buffer → table
 * pipeline. It now delegates to the same hook + component the unified
 * `/signals` workspace uses, so behaviour stays identical across both
 * surfaces with zero duplication.
 */

import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import { LiveSignalTail } from '../components/LiveSignalTail';
import { useLiveSignalStream } from '../hooks/useLiveSignalStream';

const TAIL_MAX = 500;

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

  return (
    <PageContainer
      title={t('liveMonitor.title', 'Live Signal Monitor')}
      subtitle={t('liveMonitor.subtitle', 'Real-time scrolling view of incoming vehicle signals')}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <VehicleSelect />
          <Badge variant={live.connected ? 'success' : 'danger'} dot>
            {live.connected ? t('liveMonitor.connected', 'Connected') : t('liveMonitor.disconnected', 'Disconnected')}
          </Badge>
        </div>
      }
    >
      <LiveSignalTail
        entries={live.tailEntries}
        rate={live.tailRate}
        paused={live.tailPaused}
        onPauseToggle={() => live.setTailPaused((p) => !p)}
        onClear={live.clearTail}
        bufferMax={TAIL_MAX}
      />
    </PageContainer>
  );
}
