import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEvidencePanel } from './EventEvidencePanel';
import { deriveMetadataCandidates, deriveMotionCandidate, deriveTelemetryCandidates, mergeEventCandidates } from '../../lib/eventDetection';
import { buildIncidentManifest } from '../../lib/redactionExport';
import type { ClipRecord, EventCandidate } from '../../lib/types';
import english from '@/i18n/en.json';

// Locale-provider regressions require the real context-aware hook.
vi.unmock('react-i18next');

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber: (value: number) => value.toFixed(2) }),
}));

afterEach(cleanup);

function clip(eventCandidates: EventCandidate[]): ClipRecord {
  return {
    id: 'clip-1', fileName: 'user clip.mp4', cameraPosition: 'front',
    cameraRaw: 'front', source: 'SavedClips', capturedAtRaw: null,
    durationSeconds: 60, sizeBytes: 1, mimeType: 'video/mp4', blob: new Blob(),
    eventSidecar: null, motion: { status: 'not_run' }, eventCandidates,
    redactions: [], vehicleId: null, notes: 'User notes', createdAt: '', updatedAt: '',
  };
}

async function translations() {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en', fallbackLng: 'en',
    resources: {
      en: { translation: english },
      fr: { translation: { dashcam: { events: { basis: {
        reason: 'raison event.json : "{{reason}}"',
        folder: 'dossier : {{folder}}',
        sentryFolder: 'dossier : {{folder}} (cause inconnue)',
        savedFolder: 'dossier : {{folder}} (clip enregistré sans métadonnées)',
        motionScore: 'différence de pixels : {{score}} sur {{pairs}} paires',
        motionDisclaimer: 'heuristique uniquement — aucune reconnaissance effectuée',
      } } } } },
    },
  });
  return i18n;
}

describe('EventEvidencePanel generated basis localization', () => {
  it('localizes persisted descriptors on language change without translating raw metadata or export facts', async () => {
    const reason = 'user <reason> & "text"';
    const sidecar = { timestamp: null, city: null, est_lat: null, est_lon: null, camera: null, reason };
    const candidates = mergeEventCandidates(
      deriveMetadataCandidates({ source: 'SavedClips', eventSidecar: sidecar }),
      deriveMetadataCandidates({ source: 'SentryClips', eventSidecar: null }),
      deriveMetadataCandidates({ source: 'SavedClips', eventSidecar: null }),
      deriveMotionCandidate({ status: 'ok', score: 0.5, samplePairs: 5 }),
    );
    const persisted: EventCandidate[] = JSON.parse(JSON.stringify(candidates));
    const current = clip(persisted);
    current.eventSidecar = sidecar;
    const before = JSON.stringify(current.eventCandidates);
    const i18n = await translations();
    const view = render(<I18nextProvider i18n={i18n}><EventEvidencePanel clip={current} /></I18nextProvider>);
    expect(screen.getByText(`event.json reason: "${reason}" — folder: SavedClips`)).toBeInTheDocument();
    expect(screen.getByText(/sampled-frame pixel-difference score: 0.500 across 5/)).toBeInTheDocument();
    await i18n.changeLanguage('fr');
    view.rerender(<I18nextProvider i18n={i18n}><EventEvidencePanel clip={current} /></I18nextProvider>);
    expect(screen.getByText(`raison event.json : "${reason}" — dossier : SavedClips`)).toBeInTheDocument();
    expect(screen.getByText('dossier : SentryClips (cause inconnue)')).toBeInTheDocument();
    expect(screen.getByText('dossier : SavedClips (clip enregistré sans métadonnées)')).toBeInTheDocument();
    expect(screen.getByText('différence de pixels : 0.500 sur 5 paires — heuristique uniquement — aucune reconnaissance effectuée')).toBeInTheDocument();
    expect(JSON.stringify(current.eventCandidates)).toBe(before);
    expect(current.eventSidecar?.reason).toBe(reason);
    const manifest = buildIncidentManifest(current, null);
    expect(manifest.eventCandidates).toEqual(persisted);
    expect(manifest.eventCandidates[0].basis).toEqual([`event.json reason: "${reason}"`, 'folder: SavedClips']);
    expect(manifest.eventCandidates[3].basis[1]).toBe('basis: luminance delta heuristic only — no object/person/plate recognition was performed');
  });

  it('preserves legacy and user text even when it resembles generated basis, plus telemetry and zero timestamps', async () => {
    const generated = deriveMetadataCandidates({ source: 'SavedClips', eventSidecar: null })[0];
    generated.basis = ['User-edited evidence'];
    const current = clip([
      { id: 'legacy', type: 'manual_save', confidence: 'low', atSeconds: null,
        basis: ['folder: SavedClips (user-saved clip; no event metadata found)', 'Custom folder/name'] },
      generated,
      ...deriveTelemetryCandidates([{ id: 'telemetry', kind: 'hard_brake', signal: 'User signal',
        zScore: 6, atSeconds: 0, description: 'Exact telemetry description' }]),
    ]);
    const i18n = await translations();
    await i18n.changeLanguage('fr');
    render(<I18nextProvider i18n={i18n}><EventEvidencePanel clip={current} /></I18nextProvider>);
    expect(screen.getByText('folder: SavedClips (user-saved clip; no event metadata found) — Custom folder/name')).toBeInTheDocument();
    expect(screen.getByText('User-edited evidence')).toBeInTheDocument();
    expect(screen.getByText('Exact telemetry description')).toBeInTheDocument();
    expect(screen.getByText('t=0.00s')).toBeInTheDocument();
    expect(screen.getAllByText('whole clip')).toHaveLength(2);
  });

  it('distinguishes metadata/motion clip candidates from separate reconstruction incidents', async () => {
    const i18n = await translations();
    const current = clip([]);
    const incidents = [{ id: 'telemetry', kind: 'hard_brake' as const, signal: 'Speed',
      zScore: 6, atSeconds: 0, description: 'Exact reconstruction incident' }];
    expect(deriveTelemetryCandidates(incidents)).toEqual([expect.objectContaining({
      type: 'hard_brake', confidence: 'high', atSeconds: 0, basis: ['Exact reconstruction incident'],
    })]);
    expect(current.eventCandidates).toEqual([]);
    expect(incidents[0].description).toBe('Exact reconstruction incident');
    render(<I18nextProvider i18n={i18n}><EventEvidencePanel clip={current} /></I18nextProvider>);
    expect(screen.getByText('No event candidates yet')).toBeInTheDocument();
    expect(screen.getByText(english.dashcam.events.emptyMessage)).toBeInTheDocument();
    expect(english.dashcam.events.emptyMessage).toContain('Import metadata (event.json / folder) or run local motion analysis');
    expect(english.dashcam.events.emptyMessage).toContain('View telemetry-derived incidents separately in the Reconstruction tab');
    expect(english.dashcam.events.emptyMessage).toContain('they are not added to this clip’s event evidence');
    expect(screen.queryByText('Exact reconstruction incident')).not.toBeInTheDocument();
  });
});
