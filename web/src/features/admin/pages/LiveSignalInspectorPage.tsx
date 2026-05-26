/**
 * Live Signal Inspector Page — realtime per-vehicle signal viewer.
 *
 * Polls `GET /api/v1/signals/{vehicleID}/live` every 1 s while the page
 * is visible and renders the result as a filterable + sortable table.
 * The 1 s cadence is intentional — operators using this page need
 * near-realtime feedback while triaging a stalled or noisy signal.
 *
 * Polling pauses automatically when the browser tab is hidden
 * (`refetchIntervalInBackground:false` is set on the underlying hook),
 * so leaving the page open in a background tab does not flood the API.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Radio } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, type SelectOption } from '@/components/ui';
import { PanelTitle } from '@/components/ui/Typography';
import { FadeIn } from '@/components/motion';
import { EmptyState, SectionErrorBoundary } from '@/components/feedback';
import { LiveIndicator } from '@/components/data-display';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';

import { LiveSignalsTable } from '../components/live-signal-inspector';

export default function LiveSignalInspectorPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.liveSignals.pageTitle', 'Live Signal Inspector'));

  const [vehicleId, setVehicleId] = useState<number | null>(null);

  const vehicles = useVehicles();
  const live = useVehicleLiveSignals(vehicleId ?? undefined, {
    refetchInterval: 1_000,
    enabled: vehicleId !== null,
  });

  const vehicleOptions: SelectOption[] = [
    {
      value: '',
      label: t('admin.liveSignals.controls.selectVehicle', 'Select vehicle…'),
    },
    ...(vehicles.data ?? []).map((v) => ({
      value: String(v.id),
      label: v.display_name || v.vin || `Vehicle ${v.id}`,
    })),
  ];

  return (
    <PageContainer
      title={t('admin.liveSignals.pageTitle', 'Live Signal Inspector')}
      subtitle={t(
        'admin.liveSignals.subtitle',
        'Realtime view of the Redis-cached live signal snapshot. Refreshes every second while this tab is in the foreground.',
      )}
      actions={
        vehicleId !== null ? <LiveIndicator variant="compact" /> : undefined
      }
      query={live}
    >
      <FadeIn>
        <div className="space-y-6">
          <SectionErrorBoundary name="live-controls">
            <GlassPanel className="p-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="w-64">
                  <Select
                    value={vehicleId !== null ? String(vehicleId) : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setVehicleId(v ? Number(v) : null);
                    }}
                    options={vehicleOptions}
                    aria-label={t(
                      'admin.liveSignals.controls.vehicleAria',
                      'Vehicle',
                    )}
                  />
                </div>
              </div>
            </GlassPanel>
          </SectionErrorBoundary>

          {vehicleId === null ? (
            <GlassPanel className="p-6">
              <EmptyState
                icon={<Radio className="h-12 w-12" />}
                title={t(
                  'admin.liveSignals.noVehicle.title',
                  'Select a vehicle',
                )}
                message={t(
                  'admin.liveSignals.noVehicle.message',
                  'Pick a vehicle from the dropdown above to start streaming its live signal cache.',
                )}
                // no-action: inline picker is the only sensible CTA target.
              />
            </GlassPanel>
          ) : (
            <SectionErrorBoundary name="live-signals">
              <GlassPanel className="p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-[var(--text-muted)]" />
                  <PanelTitle>
                    {t('admin.liveSignals.panels.snapshot', 'Live snapshot')}
                  </PanelTitle>
                </div>
                <LiveSignalsTable data={live.data} loading={live.isLoading} />
              </GlassPanel>
            </SectionErrorBoundary>
          )}
        </div>
      </FadeIn>
    </PageContainer>
  );
}
