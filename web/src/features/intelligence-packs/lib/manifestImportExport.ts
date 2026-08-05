/**
 * Import/export helpers for signed pack envelopes as standalone `.json`
 * files. Import always re-runs the full `parseSignedEnvelope` pipeline —
 * there is no "trust because it came from disk" shortcut.
 */

import { parseSignedEnvelope } from './manifestValidator';
import type { SignedPackEnvelope } from './manifestTypes';

export function envelopeToPrettyJson(envelope: SignedPackEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

export function exportFilenameFor(envelope: SignedPackEnvelope): string {
  const safeId = envelope.manifest.id.replace(/[^a-z0-9._-]/gi, '_');
  return `intelligence-pack-${safeId}-${envelope.manifest.version}.json`;
}

export interface ImportParseOutcome {
  ok: boolean;
  envelope: SignedPackEnvelope | null;
  errors: string[];
}

/** Parses+validates file text through the exact same pipeline used for the catalog and any other input source. */
export function parseImportedEnvelopeText(rawText: string): ImportParseOutcome {
  const result = parseSignedEnvelope(rawText);
  if (!result.ok) return { ok: false, envelope: null, errors: result.errors };
  return { ok: true, envelope: result.value, errors: [] };
}

/** Browser file-picker helper: reads a `File`'s text content. Kept tiny/isolated so components stay testable without real `File` objects. */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

/** Triggers a browser download of the envelope as pretty JSON. No-ops outside a DOM environment. */
export function downloadEnvelope(envelope: SignedPackEnvelope): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([envelopeToPrettyJson(envelope)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilenameFor(envelope);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
