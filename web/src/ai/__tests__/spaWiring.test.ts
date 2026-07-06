// Contract test for the generated SPA AI-wiring table.
//
// `web/src/ai/spaWiring.ts` is emitted by `tools/aigen --spa-wiring` from the
// Go `SPAWiringTable` and is marked DO NOT EDIT — CI regenerates it and fails
// on drift. Because it is generated we do not (and must not) hand-edit it; the
// way we "elevate" a generated data module is to lock its output contract with
// runtime invariants so a future regeneration cannot silently ship a malformed
// endpoint, an unknown feature id, a method/path mismatch, a divergence between
// the array and the by-id map, a mutable entry, or wiring that points at a
// component file that no longer exists on disk.
//
// The offenders-are-empty assertion style (`expect(offenders).toEqual([])`) is
// deliberate: when an invariant breaks, vitest prints the exact rows at fault
// instead of a bare `false`, which makes a generator regression trivial to
// pinpoint.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPA_WIRING, SPA_WIRING_BY_ID } from '@/ai/spaWiring';
import type { RenderContract, SPAWiringEntry } from '@/ai/spaWiring';
import { AI_FEATURES, AI_FEATURE_IDS, isKnownAiFeature } from '@/ai/features';
import type { AiFeatureId } from '@/ai/features';

// The request() client (api/client.ts) auto-prepends this; endpointPath must be
// ready to hand to useAiStream({ url }) WITHOUT it.
const API_PREFIX = '/api/v1';
const VALID_RENDERS: readonly RenderContract[] = ['narrative', 'proposal', 'suggestion'];
const HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// The generated component paths are relative to web/src/. Resolve that root
// from this test's own location so the on-disk existence check is independent
// of the process working directory.
const here = path.dirname(fileURLToPath(import.meta.url)); // web/src/ai/__tests__
const SRC_ROOT = path.resolve(here, '..', '..'); // web/src

// Typing the shared view through the public interface exercises the exported
// `SPAWiringEntry` type as well as the data.
const entries: readonly SPAWiringEntry[] = SPA_WIRING;

/** Split "POST /api/v1/ai/foo" into its verb and path halves. */
function splitEndpoint(endpoint: string): { method: string; fullPath: string; parts: number } {
  const bits = endpoint.split(' ');
  return { method: bits[0] ?? '', fullPath: bits[1] ?? '', parts: bits.length };
}

describe('SPA_WIRING — table shape & typing', () => {
  it('is a non-empty, frozen array of fully-populated string entries', () => {
    expect(Array.isArray(SPA_WIRING)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
    expect(Object.isFrozen(SPA_WIRING)).toBe(true);

    const REQUIRED = [
      'featureId',
      'component',
      'endpoint',
      'endpointPath',
      'method',
      'render',
      'baselineFormHandoff',
    ] as const;

    // Every entry must carry every field; only baselineFormHandoff is allowed
    // to be the empty string (narrative entries legitimately have no handoff).
    const malformed = entries.filter((e) =>
      REQUIRED.some((k) => {
        const v = e[k as keyof SPAWiringEntry];
        if (typeof v !== 'string') return true;
        return v.length === 0 && k !== 'baselineFormHandoff';
      }),
    );
    expect(malformed).toEqual([]);
  });

  it('exposes the documented render-contract union and nothing else', () => {
    const badRender = entries.filter((e) => !VALID_RENDERS.includes(e.render));
    expect(badRender).toEqual([]);
    // Sanity that the union constant itself is intact.
    expect(VALID_RENDERS).toContain('narrative');
    expect(VALID_RENDERS).toHaveLength(3);
  });
});

describe('SPA_WIRING — feature-id integrity', () => {
  it('references only known AI feature ids that exist in the registry', () => {
    const unknown = entries.filter(
      (e) => !isKnownAiFeature(e.featureId) || AI_FEATURES[e.featureId] === undefined,
    );
    expect(unknown).toEqual([]);

    // The registry meta must round-trip its own id back.
    const idMismatch = entries.filter((e) => AI_FEATURES[e.featureId].id !== e.featureId);
    expect(idMismatch).toEqual([]);
  });

  it('contains no duplicate feature ids', () => {
    const ids = entries.map((e) => e.featureId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never wires internal (double-underscore) meta features into the SPA', () => {
    const wired = new Set<AiFeatureId>(entries.map((e) => e.featureId));
    // e.g. "__usage__" / "__redaction_bypass__" are backend-only surfaces and
    // must never acquire a user-facing component.
    const internalIds = AI_FEATURE_IDS.filter((id) => /^__.+__$/.test(id));
    const leaked = internalIds.filter((id) => wired.has(id));
    expect(internalIds.length).toBeGreaterThan(0);
    expect(leaked).toEqual([]);
  });
});

describe('SPA_WIRING — endpoint / method / path invariants', () => {
  it('decomposes endpoint into "<METHOD> /api/v1<endpointPath>"', () => {
    const badFormat = entries.filter((e) => splitEndpoint(e.endpoint).parts !== 2);
    expect(badFormat).toEqual([]);

    const methodMismatch = entries.filter((e) => splitEndpoint(e.endpoint).method !== e.method);
    expect(methodMismatch).toEqual([]);

    const pathMismatch = entries.filter(
      (e) => splitEndpoint(e.endpoint).fullPath !== `${API_PREFIX}${e.endpointPath}`,
    );
    expect(pathMismatch).toEqual([]);
  });

  it('uses only uppercase, recognised HTTP verbs', () => {
    const badVerb = entries.filter(
      (e) => e.method !== e.method.toUpperCase() || !HTTP_METHODS.has(e.method),
    );
    expect(badVerb).toEqual([]);
  });

  it('keeps endpointPath prefix-free and ready for useAiStream', () => {
    const bad = entries.filter(
      (e) =>
        !e.endpointPath.startsWith('/') ||
        e.endpointPath.startsWith(API_PREFIX) ||
        e.endpointPath.includes('/api/') ||
        e.endpointPath.includes('//') ||
        /\s/.test(e.endpointPath),
    );
    expect(bad).toEqual([]);
  });

  it('assigns a unique endpoint and endpointPath to every feature', () => {
    const endpoints = entries.map((e) => e.endpoint);
    const paths = entries.map((e) => e.endpointPath);
    expect(new Set(endpoints).size).toBe(endpoints.length);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('SPA_WIRING — render/handoff coupling', () => {
  it('ties baselineFormHandoff to the render contract (narrative ⇒ empty, else ⇒ SPA route)', () => {
    // narrative rows must not carry a handoff...
    const narrativeWithHandoff = entries.filter(
      (e) => e.render === 'narrative' && e.baselineFormHandoff !== '',
    );
    expect(narrativeWithHandoff).toEqual([]);

    // ...and proposal/suggestion rows must carry an in-app route ("/...").
    const nonNarrativeMissingHandoff = entries.filter(
      (e) =>
        e.render !== 'narrative' &&
        (e.baselineFormHandoff === '' || !e.baselineFormHandoff.startsWith('/')),
    );
    expect(nonNarrativeMissingHandoff).toEqual([]);
  });
});

describe('SPA_WIRING — component wiring points at real files', () => {
  it('lists relative .tsx components under components/ or features/', () => {
    const bad = entries.filter(
      (e) =>
        e.component.startsWith('/') ||
        e.component.includes('..') ||
        !e.component.endsWith('.tsx') ||
        !/^(components|features)\//.test(e.component),
    );
    expect(bad).toEqual([]);
    // Every component owns its own file — no two features share a component.
    const comps = entries.map((e) => e.component);
    expect(new Set(comps).size).toBe(comps.length);
  });

  it('resolves every component path to a file that exists on disk', () => {
    // Guard the harness itself before trusting a green result.
    expect(fs.existsSync(SRC_ROOT)).toBe(true);
    const missing = entries.filter((e) => !fs.existsSync(path.join(SRC_ROOT, e.component)));
    expect(missing).toEqual([]);
  });
});

describe('SPA_WIRING_BY_ID — map mirrors the array', () => {
  it('is frozen and keyed by exactly the array feature ids', () => {
    expect(Object.isFrozen(SPA_WIRING_BY_ID)).toBe(true);

    const arrayIds = entries.map((e) => e.featureId).sort();
    const mapKeys = Object.keys(SPA_WIRING_BY_ID).sort();
    expect(mapKeys).toEqual(arrayIds);
    expect(mapKeys).toHaveLength(entries.length);
  });

  it('stores each entry under its own featureId with identical field values', () => {
    const keyMismatch = (Object.keys(SPA_WIRING_BY_ID) as AiFeatureId[]).filter(
      (key) => SPA_WIRING_BY_ID[key].featureId !== key,
    );
    expect(keyMismatch).toEqual([]);

    // Map entry must deep-equal the array entry for the same feature.
    const divergent = entries.filter((e) => {
      const viaMap = SPA_WIRING_BY_ID[e.featureId];
      return JSON.stringify(viaMap) !== JSON.stringify(e);
    });
    expect(divergent).toEqual([]);
    // Spot-check a concrete, load-bearing surface: the chatbot page.
    expect(SPA_WIRING_BY_ID['chatbot-llm']).toEqual(
      entries.find((e) => e.featureId === 'chatbot-llm'),
    );
  });
});

describe('SPA_WIRING — deep immutability', () => {
  it('freezes every individual entry and rejects mutation', () => {
    const notFrozen = entries.filter((e) => !Object.isFrozen(e));
    expect(notFrozen).toEqual([]);

    // Frozen entries throw on write in ESM strict mode.
    expect(() => {
      (SPA_WIRING[0] as unknown as { method: string }).method = 'GET';
    }).toThrow();

    // The container itself is frozen too — no appends.
    expect(() => {
      (SPA_WIRING as unknown as SPAWiringEntry[]).push(SPA_WIRING[0]);
    }).toThrow();
  });
});
