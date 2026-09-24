import { TypographyAgentLoop, DEFAULT_TYPOGRAPHY_SPEC } from './orchestrator';
import type { TypographySpec, VerificationResult } from './types';

// localStorage shim for the node environment.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  get length() {
    return store.size;
  },
  key: (i: number) => [...store.keys()][i] ?? null,
} as Storage);

const clean: VerificationResult = { passed: true, score: 100, anomalies: [] };

function fakeVerifier(result: VerificationResult = clean, healed?: TypographySpec) {
  return {
    evaluate: vi.fn(async () => result),
    heal: vi.fn((spec: TypographySpec) => healed ?? spec),
  };
}

describe('TypographyAgentLoop', () => {
  beforeEach(() => store.clear());

  it('dispatches through harmonize → verify and persists the spec', async () => {
    const verifier = fakeVerifier();
    const agent = new TypographyAgentLoop(DEFAULT_TYPOGRAPHY_SPEC, { verifier: verifier as never });
    const seen: Array<{ spec: TypographySpec; result: VerificationResult }> = [];
    agent.subscribe((spec, result) => seen.push({ spec, result }));

    const result = await agent.dispatch({ density: 'compact' });

    expect(result).toEqual(clean);
    expect(verifier.evaluate).toHaveBeenCalledTimes(1);
    expect(agent.currentSpec.density).toBe('compact');
    expect(seen).toHaveLength(1);
    expect(seen[0].spec.density).toBe('compact');
    // Persisted for the next session.
    expect(TypographyAgentLoop.loadPersisted()?.density).toBe('compact');
  });

  it('heals once and re-verifies when the first pass fails', async () => {
    const failing: VerificationResult = {
      passed: false,
      score: 75,
      anomalies: [{ selector: 'body', type: 'TEXT_OVERFLOW', severity: 'critical', details: 'x' }],
    };
    const healedSpec: TypographySpec = { ...DEFAULT_TYPOGRAPHY_SPEC, density: 'compact' };
    const verifier = fakeVerifier(failing, healedSpec);
    verifier.evaluate
      .mockResolvedValueOnce(failing)
      .mockResolvedValueOnce(clean);
    const agent = new TypographyAgentLoop(DEFAULT_TYPOGRAPHY_SPEC, { verifier: verifier as never });

    const result = await agent.dispatch({ density: 'relaxed' });

    expect(verifier.heal).toHaveBeenCalledTimes(1);
    expect(verifier.evaluate).toHaveBeenCalledTimes(2);
    expect(agent.currentSpec).toEqual(healedSpec);
    expect(result).toEqual(clean);
  });

  it('unsubscribes cleanly', async () => {
    const agent = new TypographyAgentLoop(DEFAULT_TYPOGRAPHY_SPEC, {
      verifier: fakeVerifier() as never,
    });
    const cb = vi.fn();
    const off = agent.subscribe(cb);
    off();
    await agent.dispatch({ density: 'compact' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('rejects corrupt persisted specs', () => {
    store.set('teslasync-typography-spec', '{not json');
    expect(TypographyAgentLoop.loadPersisted()).toBeNull();
    store.set('teslasync-typography-spec', JSON.stringify({ ratio: 'majorThird' }));
    expect(TypographyAgentLoop.loadPersisted()).toBeNull();
  });
});
