import type { ClipRecord, EventCandidate, RedactionRegion } from './types';
import type { ReconstructionResult } from './timelineAlignment';

/**
 * Canonical, JSON-serializable summary of a clip + its local analysis,
 * intended for export/sharing (e.g. attaching to an insurance claim or
 * incident report). Contains ONLY metadata the user already has locally —
 * no video bytes, no raw redacted pixel data.
 */
export interface IncidentManifest {
  schemaVersion: 1;
  generatedAt: string;
  clip: {
    fileName: string;
    cameraPosition: string;
    source: string;
    capturedAtRaw: string | null;
    durationSeconds: number | null;
  };
  eventCandidates: EventCandidate[];
  redactions: Array<Pick<RedactionRegion, 'id' | 'kind' | 'label' | 'x' | 'y' | 'width' | 'height'>>;
  reconstruction: {
    included: boolean;
    overallQuality?: ReconstructionResult['overallQuality'];
    qualityNotes?: string[];
    signalCount?: number;
    incidentSequence?: ReconstructionResult['incidentSequence'];
  };
  disclaimers: string[];
}

const STANDARD_DISCLAIMERS = [
  'Generated entirely client-side by TeslaSync — no clip data was uploaded to build this manifest.',
  'Event candidates are heuristic inferences from filenames, folder placement, event.json metadata, and/or statistical telemetry analysis — they are not a verified determination of what occurred.',
  'Any "motion" candidate is a sampled-frame pixel-difference score, not computer-vision object/person/plate detection.',
  'Telemetry alignment assumes a user-supplied camera-clock timezone offset; verify it against a known event if precise timing matters.',
];

/** Builds a canonical incident manifest from a clip and (optionally) its reconstruction result. */
export function buildIncidentManifest(clip: ClipRecord, reconstruction: ReconstructionResult | null): IncidentManifest {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    clip: {
      fileName: clip.fileName,
      cameraPosition: clip.cameraPosition,
      source: clip.source,
      capturedAtRaw: clip.capturedAtRaw,
      durationSeconds: clip.durationSeconds,
    },
    eventCandidates: clip.eventCandidates,
    redactions: clip.redactions.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    })),
    reconstruction: reconstruction
      ? {
          included: true,
          overallQuality: reconstruction.overallQuality,
          qualityNotes: reconstruction.qualityNotes,
          signalCount: reconstruction.series.length,
          incidentSequence: reconstruction.incidentSequence,
        }
      : { included: false },
    disclaimers: STANDARD_DISCLAIMERS,
  };
}

/** Triggers a browser download of a JSON blob. Mirrors the pattern in `@/lib/export.ts`. */
export function downloadJson(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlobAs(blob, filename);
}

/** Triggers a browser download of an arbitrary blob (used for redacted-still PNG export). */
export function downloadBlobAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Minimal shape this module needs from a canvas 2D context to render a redacted still. */
export interface RedactionDrawContext {
  drawImage(source: unknown, dx: number, dy: number, dw: number, dh: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillStyle: string;
}

/**
 * Draws the current video frame plus solid-filled redaction rectangles onto
 * a caller-supplied canvas context. Pure with respect to I/O — the caller
 * owns canvas creation and the eventual `toBlob`/`toDataURL` call, keeping
 * this function testable with a mock context.
 */
export function drawRedactedFrame(
  ctx: RedactionDrawContext,
  videoSource: unknown,
  frameWidth: number,
  frameHeight: number,
  regions: RedactionRegion[],
): void {
  ctx.drawImage(videoSource, 0, 0, frameWidth, frameHeight);
  ctx.fillStyle = '#000000';
  for (const region of regions) {
    ctx.fillRect(
      region.x * frameWidth,
      region.y * frameHeight,
      region.width * frameWidth,
      region.height * frameHeight,
    );
  }
}
