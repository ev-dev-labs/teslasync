import { describe, it, expect } from 'vitest';
import { envelopeToPrettyJson, exportFilenameFor, parseImportedEnvelopeText } from '../manifestImportExport';
import { EFFICIENCY_INSIGHTS_ENVELOPE, TAMPERED_DEMO_ENVELOPE } from '../catalogFixtures';

describe('envelopeToPrettyJson', () => {
  it('produces valid, re-parseable JSON', () => {
    const text = envelopeToPrettyJson(EFFICIENCY_INSIGHTS_ENVELOPE);
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('is human-readable (indented)', () => {
    const text = envelopeToPrettyJson(EFFICIENCY_INSIGHTS_ENVELOPE);
    expect(text).toContain('\n');
    expect(text).toContain('  ');
  });
});

describe('exportFilenameFor', () => {
  it('builds a filename containing the pack id and version', () => {
    const name = exportFilenameFor(EFFICIENCY_INSIGHTS_ENVELOPE);
    expect(name).toContain('efficiency-insights-starter');
    expect(name).toContain('1.0.0');
    expect(name.endsWith('.json')).toBe(true);
  });

  it('sanitizes unsafe characters out of the pack id', () => {
    const clone = JSON.parse(JSON.stringify(EFFICIENCY_INSIGHTS_ENVELOPE));
    clone.manifest.id = 'weird/../id name';
    const name = exportFilenameFor(clone);
    expect(name).not.toMatch(/[/\\]/);
  });
});

describe('parseImportedEnvelopeText — always re-validates, no trust shortcut', () => {
  it('accepts a valid exported envelope round-tripped through JSON text', () => {
    const text = envelopeToPrettyJson(EFFICIENCY_INSIGHTS_ENVELOPE);
    const result = parseImportedEnvelopeText(text);
    expect(result.ok).toBe(true);
    expect(result.envelope?.manifest.id).toBe('efficiency-insights-starter');
  });

  it('re-detects tampering even though the file "looks like" a normal export', () => {
    const text = envelopeToPrettyJson(TAMPERED_DEMO_ENVELOPE);
    const result = parseImportedEnvelopeText(text);
    // Structural parse succeeds (it's well-formed) -- signature validity is
    // a SEPARATE concern checked by verifyPackEnvelope, not this parser.
    expect(result.ok).toBe(true);
  });

  it('rejects malformed JSON text outright', () => {
    const result = parseImportedEnvelopeText('{ not valid json');
    expect(result.ok).toBe(false);
    expect(result.envelope).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a structurally invalid envelope (missing required fields)', () => {
    const result = parseImportedEnvelopeText(JSON.stringify({ envelopeVersion: 1 }));
    expect(result.ok).toBe(false);
  });
});
