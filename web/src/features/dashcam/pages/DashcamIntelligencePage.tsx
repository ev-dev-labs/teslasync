import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Video } from 'lucide-react';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useClipCatalog } from '../hooks/useClipCatalog';
import { useDashcamDb } from '../hooks/useDashcamDb';
import { filterClips, defaultClipFilterState } from '../lib/clipFilter';
import {
  ImportPanel,
  ClipFilterBar,
  ClipCatalogList,
  ClipDetailPanel,
} from '../components/dashcam';

/**
 * Local Dashcam / Sentry Intelligence — a fully local-first vertical slice:
 * searchable clip catalog, privacy redaction, honest local event detection,
 * and telemetry-synchronized incident reconstruction. Nothing here uploads
 * clip bytes or identifying metadata; the only network calls this page
 * makes are the existing vehicle-telemetry read endpoints used for
 * reconstruction.
 */
export default function DashcamIntelligencePage() {
  const { t } = useTranslation();
  usePageTitle(t('dashcam.page.title', 'Dashcam & Sentry Intelligence'));

  const { vehicleId } = useSelectedVehicle();
  const { persistent, fallbackReason } = useDashcamDb();
  const clipsQuery = useClipCatalog();
  const [filters, setFilters] = useState(defaultClipFilterState());
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const clips = useMemo(() => clipsQuery.data ?? [], [clipsQuery.data]);
  const filteredClips = useMemo(() => filterClips(clips, filters), [clips, filters]);
  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) ?? null,
    [clips, selectedClipId],
  );

  return (
    <PageContainer
      title={t('dashcam.page.title', 'Dashcam & Sentry Intelligence')}
      subtitle={t(
        'dashcam.page.subtitle',
        'Local-only clip catalog, privacy redaction, and telemetry-synchronized incident reconstruction. Nothing leaves this browser.',
      )}
      loading={clipsQuery.isLoading}
      actions={<VehicleSelect withIcon />}
    >
      <FadeIn>
        <div className="space-y-4">
          {!persistent && (
            <GlassPanel padding="sm" className="border-amber-400/30 bg-amber-500/5">
              <p className="text-xs text-amber-200/90">
                {t(
                  'dashcam.page.noPersistence',
                  'Local storage is not persistent in this browser ({{reason}}) — imported clips will be lost when this tab closes.',
                  { reason: fallbackReason ?? t('dashcam.page.unknownReason', 'unknown reason') },
                )}
              </p>
            </GlassPanel>
          )}

          <ImportPanel vehicleId={vehicleId} />

          <Grid cols={{ default: 1, lg: 3 }} gap={4}>
            <div className="space-y-4 lg:col-span-1">
              <GlassPanel padding="md">
                <ClipFilterBar clips={clips} filters={filters} onChange={setFilters} />
              </GlassPanel>
              <ClipCatalogList
                clips={filteredClips}
                totalCount={clips.length}
                selectedClipId={selectedClipId}
                onSelect={setSelectedClipId}
              />
            </div>

            <div className="lg:col-span-2">
              {selectedClip ? (
                <ClipDetailPanel clip={selectedClip} vehicleId={vehicleId} />
              ) : (
                <GlassPanel padding="lg">
                  <EmptyState
                    icon={<Video className="h-8 w-8" />}
                    title={t('dashcam.detail.emptyTitle', 'No clip selected')}
                    message={t('dashcam.detail.emptyMessage', 'Choose a clip from the catalog to play it back, redact it, review event evidence, or reconstruct the incident timeline.')}
                  />
                </GlassPanel>
              )}
            </div>
          </Grid>
        </div>
      </FadeIn>
    </PageContainer>
  );
}
