import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@/components/ui';
import type { ClipRecord } from '../../lib/types';
import { defaultDashcamSettings } from '../../lib/types';
import { useDashcamSettings, useUpdateDashcamSettings } from '../../hooks/useDashcamSettings';
import { useReconstruction } from '../../hooks/useReconstruction';
import { ClipPlayerPanel } from './ClipPlayerPanel';
import { RedactionEditor } from './RedactionEditor';
import { EventEvidencePanel } from './EventEvidencePanel';
import { ReconstructionTimeline } from './ReconstructionTimeline';
import { ExportManifestPanel } from './ExportManifestPanel';

export interface ClipDetailPanelProps {
  clip: ClipRecord;
  vehicleId: number | null;
}

type TabKey = 'player' | 'redaction' | 'events' | 'reconstruction' | 'export';

/**
 * Tabbed orchestrator for a single selected clip. Owns the reconstruction
 * hook + signal selection state so the same telemetry-alignment result can
 * feed both the Reconstruction tab and the Export manifest without being
 * re-derived twice.
 */
export function ClipDetailPanel({ clip, vehicleId }: ClipDetailPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>('player');
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);

  const settingsQuery = useDashcamSettings();
  const updateSettings = useUpdateDashcamSettings();
  const settings = settingsQuery.data ?? defaultDashcamSettings();

  const reconstruction = useReconstruction(vehicleId ?? 0, clip, settings, selectedSignals);

  const tabs = [
    { key: 'player' as const, label: t('dashcam.tabs.player', 'Player') },
    { key: 'redaction' as const, label: t('dashcam.tabs.redaction', 'Redaction') },
    { key: 'events' as const, label: t('dashcam.tabs.events', 'Events') },
    { key: 'reconstruction' as const, label: t('dashcam.tabs.reconstruction', 'Reconstruction') },
    { key: 'export' as const, label: t('dashcam.tabs.export', 'Export') },
  ];

  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} activeTab={activeTab} onChange={(key) => setActiveTab(key as TabKey)} ariaLabel={t('dashcam.tabs.ariaLabel', 'Clip detail sections')} />

      {activeTab === 'player' && <ClipPlayerPanel clip={clip} />}
      {activeTab === 'redaction' && <RedactionEditor clip={clip} />}
      {activeTab === 'events' && <EventEvidencePanel clip={clip} />}
      {activeTab === 'reconstruction' && (
        <ReconstructionTimeline
          clip={clip}
          vehicleId={vehicleId}
          settings={settings}
          onUpdateSettings={(next) => updateSettings.mutate(next)}
          selectedSignals={selectedSignals}
          onSelectedSignalsChange={setSelectedSignals}
          result={reconstruction}
        />
      )}
      {activeTab === 'export' && <ExportManifestPanel clip={clip} reconstruction={reconstruction.reconstruction} />}
    </div>
  );
}
