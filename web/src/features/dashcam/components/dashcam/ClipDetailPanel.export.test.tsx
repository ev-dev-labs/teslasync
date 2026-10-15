import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { SignalHistoryResponse } from '@/types/telemetry';
import type { UseReconstructionResult } from '../../hooks/useReconstruction';
import { defaultDashcamSettings, type ClipRecord, type DashcamSettings } from '../../lib/types';
import { buildIncidentManifest } from '../../lib/redactionExport';
import type { ExportManifestPanelProps } from './ExportManifestPanel';
import { ClipDetailPanel } from './ClipDetailPanel';

const queries = vi.hoisted(() => ({
  settings: {} as DataStateSource<DashcamSettings>,
  reconstruction: {} as UseReconstructionResult,
  exportProps: null as ExportManifestPanelProps | null,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('../../hooks/useDashcamSettings', () => ({
  useDashcamSettings: () => queries.settings,
  useUpdateDashcamSettings: () => ({ mutate: vi.fn() }),
}));
vi.mock('../../hooks/useReconstruction', () => ({
  useReconstruction: () => queries.reconstruction,
}));
vi.mock('./ClipPlayerPanel', () => ({ ClipPlayerPanel: () => null }));
vi.mock('./RedactionEditor', () => ({ RedactionEditor: () => null }));
vi.mock('./EventEvidencePanel', () => ({ EventEvidencePanel: () => null }));
vi.mock('./ReconstructionTimeline', () => ({ ReconstructionTimeline: () => null }));
vi.mock('./ExportManifestPanel', () => ({
  ExportManifestPanel: (props: ExportManifestPanelProps) => {
    queries.exportProps = props;
    return null;
  },
}));

const clip: ClipRecord = {
  id: 'clip', fileName: 'clip.mp4', cameraPosition: 'front', cameraRaw: null,
  source: 'SavedClips', capturedAtRaw: '2026-10-05T10:00:00', durationSeconds: 60,
  sizeBytes: 1, mimeType: 'video/mp4', blob: new Blob(), eventSidecar: null,
  motion: { status: 'not_run' }, eventCandidates: [], redactions: [], vehicleId: 2,
  notes: '', createdAt: '', updatedAt: '',
};
const response: SignalHistoryResponse = {
  vehicleId: 7, signal: 'Speed', from: '', to: '', count: 1,
  data: [{ timestamp: '2026-10-05T10:00:00Z', valueNum: 0 }],
};

beforeEach(() => {
  queries.exportProps = null;
  queries.settings = {
    data: { ...defaultDashcamSettings(), assumedTimezoneOffsetMinutes: -420 },
    dataUpdatedAt: 1000,
  };
  queries.reconstruction = {
    clipEpochMs: 1234, lookbackHours: 24, isLoading: false, isError: false,
    hasRetainedHistory: true, refetch: vi.fn(async () => {}),
    sources: [{ signal: 'Speed', state: deriveDataState({ data: response, dataUpdatedAt: 1000 }, { provenance: 'historical' }) }],
    error: null, possiblyOutOfLookbackRange: false,
    reconstruction: {
      clipWindow: { startSeconds: 0, endSeconds: 60 },
      reconstructionWindow: { startSeconds: -15, endSeconds: 75 },
      series: [{
        signal: 'Speed', coverage: 'good', gapNotes: [],
        points: [{ atSeconds: 0, timestamp: response.data[0].timestamp, value: 0 }],
      }],
      incidentSequence: [], overallQuality: 'good', qualityNotes: [],
    },
  };
});
afterEach(cleanup);

function manifest() {
  expect(queries.exportProps?.buildManifest).toBeTypeOf('function');
  return JSON.parse(JSON.stringify(queries.exportProps!.buildManifest!())) as Record<string, unknown>;
}
function openExport(vehicleId: number | null = 7) {
  const view = render(<ClipDetailPanel clip={clip} vehicleId={vehicleId} />);
  fireEvent.click(screen.getByRole('tab', { name: 'Export' }));
  return view;
}

describe('clip detail incident manifest trust', () => {
  it.each(['loading', 'paused', 'failed'] as const)('does not export synthetic alignment as evaluated during %s without data', (phase) => {
    queries.reconstruction.sources = [{
      signal: 'Speed',
      state: deriveDataState<SignalHistoryResponse>({
        isLoading: phase === 'loading', fetchStatus: phase === 'paused' ? 'paused' : 'fetching',
        error: phase === 'failed' ? new Error('Initial failure') : null,
      }),
    }];
    queries.reconstruction.hasRetainedHistory = false;
    queries.reconstruction.isLoading = phase === 'loading';
    openExport();
    expect(manifest()).toMatchObject({
      schemaVersion: 1,
      reconstruction: {
        included: false, status: 'unresolved', evaluated: false, vehicleId: 7,
        sources: [{ signal: 'Speed', hasData: false, isRefreshBlocked: phase === 'paused' }],
      },
    });
  });

  it('exports successful empty responses as evaluated empty, not unresolved', () => {
    queries.reconstruction.sources[0].state = deriveDataState(
      { data: { ...response, count: 0, data: [] }, isSuccess: true }, { provenance: 'historical', unavailable: true },
    );
    queries.reconstruction.reconstruction!.series[0].points = [];
    queries.reconstruction.reconstruction!.overallQuality = 'none';
    openExport();
    expect(manifest()).toMatchObject({
      reconstruction: { included: true, status: 'empty', evaluated: true, sources: [{ status: 'unavailable' }] },
    });
  });

  it('preserves version 1 raw fields, zero evidence, selected vehicle and explicit clock assumptions', () => {
    openExport();
    const legacy = buildIncidentManifest(clip, queries.reconstruction.reconstruction);
    expect(manifest()).toMatchObject({ ...legacy, generatedAt: expect.any(String) });
    expect(manifest()).toMatchObject({
      reconstruction: {
        status: 'complete', evaluated: true, vehicleId: 7,
        assumptions: { assumedTimezoneOffsetMinutes: -420, clipEpochMs: 1234, reconstructionPreRollSeconds: 15, reconstructionPostRollSeconds: 15 },
      },
    });
    expect(queries.reconstruction.reconstruction!.series[0].points[0].value).toBe(0);
  });

  it('records every source and marks mixed resolved and unresolved history as partial', () => {
    queries.reconstruction.sources.push({ signal: 'Heading', state: deriveDataState<SignalHistoryResponse>({ fetchStatus: 'paused' }) });
    openExport();
    expect(manifest()).toMatchObject({
      reconstruction: {
        included: true, status: 'partial', evaluated: false,
        sources: [{ signal: 'Speed', hasData: true }, { signal: 'Heading', hasData: false, isRefreshBlocked: true }],
      },
    });
  });

  it('retains reconstruction on refresh failure and re-evaluates after recovery', () => {
    const result = queries.reconstruction.reconstruction;
    queries.reconstruction.sources[0].state = deriveDataState(
      { data: response, error: new Error('Refresh failed'), dataUpdatedAt: 1000 }, { provenance: 'historical' },
    );
    const { rerender } = openExport();
    expect(manifest()).toMatchObject({
      reconstruction: { included: true, status: 'retained', evaluated: false, sources: [{ status: 'stale', refreshError: 'Refresh failed', updatedAt: 1000 }] },
    });
    queries.reconstruction.sources[0].state = deriveDataState(
      { data: response, dataUpdatedAt: 2000 }, { provenance: 'historical' },
    );
    rerender(<ClipDetailPanel clip={clip} vehicleId={7} />);
    expect(manifest()).toMatchObject({
      reconstruction: { included: true, status: 'complete', evaluated: true, sources: [{ status: 'ok', refreshError: null, updatedAt: 2000 }] },
    });
    expect(queries.reconstruction.reconstruction).toBe(result);
  });

  it('does not label default settings or absent vehicle scope as evaluated', () => {
    queries.settings = { fetchStatus: 'paused' };
    openExport(null);
    expect(manifest()).toMatchObject({
      reconstruction: {
        included: false, status: 'unresolved', evaluated: false, vehicleId: null,
        assumptions: { assumedTimezoneOffsetMinutes: null },
        settingsSource: { status: 'initial', isRefreshBlocked: true },
      },
    });
  });

  it.each(['refreshing', 'paused'] as const)('marks retained empty history as retained while %s', (phase) => {
    queries.reconstruction.sources[0].state = deriveDataState({
      data: { ...response, count: 0, data: [] },
      isFetching: phase === 'refreshing', fetchStatus: phase === 'paused' ? 'paused' : 'fetching',
    }, { provenance: 'historical', unavailable: true });
    queries.reconstruction.reconstruction!.series[0].points = [];
    openExport();
    expect(manifest()).toMatchObject({
      reconstruction: {
        included: true, status: 'retained', evaluated: false,
        sources: [{ isRefreshing: phase === 'refreshing', isRefreshBlocked: phase === 'paused' }],
      },
    });
  });

  it('does not confuse no selected sources with a successful empty result', () => {
    queries.reconstruction.sources = [];
    queries.reconstruction.reconstruction!.series = [];
    openExport();
    expect(manifest()).toMatchObject({
      reconstruction: { included: false, status: 'unresolved', evaluated: false, sources: [] },
    });
  });

  it('preserves retained settings assumptions while reporting their refresh failure', () => {
    queries.settings.error = new Error('Local settings refresh failed');
    openExport();
    expect(manifest()).toMatchObject({
      reconstruction: {
        included: true, status: 'retained', evaluated: false,
        assumptions: { assumedTimezoneOffsetMinutes: -420 },
        settingsSource: { status: 'stale', refreshError: 'Local settings refresh failed' },
      },
    });
  });
});
