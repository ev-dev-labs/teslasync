import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tabs } from '@/components/ui';
import { deriveDataState } from '@/api/dataState';
import type { ClipRecord } from '../../lib/types';
import { defaultDashcamSettings } from '../../lib/types';
import { useDashcamSettings, useUpdateDashcamSettings } from '../../hooks/useDashcamSettings';
import { useReconstruction } from '../../hooks/useReconstruction';
import { ClipPlayerPanel } from './ClipPlayerPanel';
import { RedactionEditor } from './RedactionEditor';
import { EventEvidencePanel } from './EventEvidencePanel';
import { ReconstructionTimeline } from './ReconstructionTimeline';
import { ExportManifestPanel } from './ExportManifestPanel';
import { DashcamSettingsSource } from './DashcamSettingsSource';
import { buildIncidentManifest } from '../../lib/redactionExport';

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
  const idBase = useId();
  const [activeTab, setActiveTab] = useState<TabKey>('player');
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);

  const settingsQuery = useDashcamSettings();
  const updateSettings = useUpdateDashcamSettings();
  const settingsSource = deriveDataState(settingsQuery);
  const settings = settingsQuery.data ?? defaultDashcamSettings();

  // Defaults are only a hook argument until the local read establishes preferences.
  const reconstruction = useReconstruction(
    settingsSource.hasData ? vehicleId ?? 0 : 0,
    settingsSource.hasData ? clip : null,
    settings,
    settingsSource.hasData ? selectedSignals : [],
  );

  // Alignment can exist before history resolves. Export evaluation trust
  // separately from coverage quality, without dropping retained raw evidence.
  const buildManifest = () => {
    const result = settingsSource.hasData ? reconstruction.reconstruction : null;
    const sources = reconstruction.sources;
    const hasHistory = sources.some(({ state }) => state.hasData);
    const unresolved = sources.length === 0 || sources.some(({ state }) => !state.hasData);
    const retained = settingsSource.status === 'stale' || settingsSource.isRefreshing
      || sources.some(({ state }) => state.status === 'stale' || state.isRefreshing || state.isRefreshBlocked);
    const status = result == null || vehicleId == null || vehicleId <= 0 || !hasHistory
      ? 'unresolved'
      : unresolved || sources.some(({ state }) => state.status === 'partial')
        ? 'partial'
        : retained
          ? 'retained'
          : result.series.every((series) => series.points.length === 0)
            ? 'empty'
            : 'complete';
    const manifest = buildIncidentManifest(clip, hasHistory ? result : null);
    return {
      ...manifest,
      reconstruction: {
        ...manifest.reconstruction,
        status,
        evaluated: status === 'empty' || status === 'complete',
        vehicleId,
        assumptions: {
          assumedTimezoneOffsetMinutes: settingsSource.hasData ? settings.assumedTimezoneOffsetMinutes : null,
          reconstructionPreRollSeconds: settingsSource.hasData ? settings.reconstructionPreRollSeconds : null,
          reconstructionPostRollSeconds: settingsSource.hasData ? settings.reconstructionPostRollSeconds : null,
          clipEpochMs: reconstruction.clipEpochMs,
          lookbackHours: reconstruction.lookbackHours,
          possiblyOutOfLookbackRange: reconstruction.possiblyOutOfLookbackRange,
        },
        settingsSource: {
          status: settingsSource.status,
          provenance: settingsSource.provenance,
          hasData: settingsSource.hasData,
          isRefreshing: settingsSource.isRefreshing,
          isRefreshBlocked: settingsSource.isRefreshBlocked,
          refreshError: settingsSource.refreshError?.message ?? null,
          fatalError: settingsSource.fatalError?.message ?? null,
          updatedAt: settingsSource.updatedAt,
          ageMs: settingsSource.ageMs,
        },
        sources: sources.map(({ signal, state }) => ({
          signal,
          status: state.status,
          provenance: state.provenance,
          hasData: state.hasData,
          isRefreshing: state.isRefreshing,
          isRefreshBlocked: state.isRefreshBlocked,
          refreshError: state.refreshError?.message ?? null,
          fatalError: state.fatalError?.message ?? null,
          updatedAt: state.updatedAt,
          ageMs: state.ageMs,
        })),
      },
    };
  };

  const tabs = [
    { key: 'player' as const, label: t('dashcam.tabs.player', 'Player') },
    { key: 'redaction' as const, label: t('dashcam.tabs.redaction', 'Redaction') },
    { key: 'events' as const, label: t('dashcam.tabs.events', 'Events') },
    { key: 'reconstruction' as const, label: t('dashcam.tabs.reconstruction', 'Reconstruction') },
    { key: 'export' as const, label: t('dashcam.tabs.export', 'Export') },
  ];

  return (
    <div className="space-y-4">
      <Tabs tabs={tabs} activeTab={activeTab} onChange={(key) => setActiveTab(key as TabKey)} idBase={idBase} ariaLabel={t('dashcam.tabs.ariaLabel', 'Clip detail sections')} />
      <div
        role="tabpanel"
        id={`${idBase}-panel-${activeTab}`}
        aria-labelledby={`${idBase}-tab-${activeTab}`}
        tabIndex={0}
        className="space-y-4"
      >
        <DashcamSettingsSource source={settingsSource} isLoading={settingsQuery.isLoading}>
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
        </DashcamSettingsSource>

        {activeTab === 'player' && <ClipPlayerPanel clip={clip} />}
        {activeTab === 'redaction' && <RedactionEditor clip={clip} />}
        {activeTab === 'events' && <EventEvidencePanel clip={clip} />}
        {activeTab === 'export' && <ExportManifestPanel clip={clip} reconstruction={settingsSource.hasData ? reconstruction.reconstruction : null} buildManifest={buildManifest} />}
      </div>
    </div>
  );
}
