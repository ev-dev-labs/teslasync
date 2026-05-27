/**
 * Ingest X-Ray Page — per-vehicle telemetry diagnostic surface.
 *
 * Lets an operator pick a vehicle + window + bucket and see, at a glance,
 * how many telemetry samples arrived, broken down by field. Backed by
 * `GET /api/v1/system/ingest-xray/{vehicleID}` (router.go ~L3580) which
 * returns a `IngestXRayResponse` with three logical sections:
 *
 *   - aggregate summary (total_samples, unique_fields) → XRayHeader
 *   - bucketed sample-count time-series                → XRayBucketChart
 *   - per-field stats (count + last_seen + kind)       → XRayFieldsTable
 *
 * The page polls every INTERVALS.FAST so it feels live while an operator
 * is actively diagnosing a stalled pipeline. Polling pauses when the
 * browser tab is hidden (`refetchIntervalInBackground:false`).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { PanelTitle } from '@/components/ui/Typography';
import { FadeIn } from '@/components/motion';
import { EmptyState, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useIngestXRay } from '@/api/hooks/useIngestXRay';
import type {
  IngestXRayBucket,
  IngestXRayWindow,
} from '@/types/admin-diagnostics';

import {
  XRayBucketChart,
  XRayControls,
  XRayFieldsTable,
  XRayHeader,
} from '../components/ingest-xray';

export default function IngestXRayPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.xray.pageTitle', 'Ingest X-Ray'));

  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [windowSel, setWindowSel] = useState<IngestXRayWindow>('1h');
  const [bucketSel, setBucketSel] = useState<IngestXRayBucket>('1m');

  const vehicles = useVehicles();
  const xray = useIngestXRay({
    vehicleId,
    window: windowSel,
    bucket: bucketSel,
    limit: 100,
  });

  return (
    <PageContainer
      title={t('admin.xray.pageTitle', 'Ingest X-Ray')}
      subtitle={t(
        'admin.xray.subtitle',
        'Per-vehicle telemetry sample counts — pick a vehicle to inspect what the ingest pipeline is receiving.',
      )}
      query={xray}
    >
      <FadeIn>
        <div className="space-y-6">
          <SectionErrorBoundary name="xray-controls">
            <GlassPanel className="p-6">
              <XRayControls
                vehicles={vehicles.data ?? []}
                vehicleId={vehicleId}
                windowSel={windowSel}
                bucketSel={bucketSel}
                onVehicleChange={setVehicleId}
                onWindowChange={setWindowSel}
                onBucketChange={setBucketSel}
              />
            </GlassPanel>
          </SectionErrorBoundary>

          {vehicleId === null ? (
            <GlassPanel className="p-6">
              <EmptyState
                title={t('admin.xray.noVehicle.title', 'Select a vehicle')}
                message={t(
                  'admin.xray.noVehicle.message',
                  'Pick a vehicle from the dropdown above to load its ingest X-Ray for the selected window.',
                )}
                // no-action: the inline picker IS the CTA.
              />
            </GlassPanel>
          ) : (
            <>
              <SectionErrorBoundary name="xray-header">
                <XRayHeader
                  data={xray.data}
                  loading={xray.isLoading}
                  windowSel={windowSel}
                />
              </SectionErrorBoundary>

              <SectionErrorBoundary name="xray-chart">
                <GlassPanel className="p-6">
                  <XRayBucketChart
                    buckets={xray.data?.buckets ?? []}
                    loading={xray.isLoading}
                  />
                </GlassPanel>
              </SectionErrorBoundary>

              <SectionErrorBoundary name="xray-fields">
                <GlassPanel className="p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Activity className="h-5 w-5 text-[var(--text-muted)]" />
                    <PanelTitle>
                      {t('admin.xray.panels.fields', 'Field statistics')}
                    </PanelTitle>
                  </div>
                  <XRayFieldsTable
                    rows={xray.data?.fields ?? []}
                    loading={xray.isLoading}
                  />
                </GlassPanel>
              </SectionErrorBoundary>
            </>
          )}
        </div>
      </FadeIn>
    </PageContainer>
  );
}
