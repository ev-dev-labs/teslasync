import { TypographyVerifier, scoreAnomalies } from './verifier';
import type { NodeAnomaly, TypographySpec } from './types';

const SPEC: TypographySpec = {
  ratio: 'majorThird',
  baseSizeMinPx: 15,
  baseSizeMaxPx: 17,
  viewportMinPx: 360,
  viewportMaxPx: 1440,
  density: 'relaxed',
};

function anomaly(over: Partial<NodeAnomaly> = {}): NodeAnomaly {
  return { selector: 'body > p', type: 'TEXT_OVERFLOW', severity: 'critical', details: 'x', ...over };
}

describe('scoreAnomalies', () => {
  it('passes a clean scan at 100', () => {
    expect(scoreAnomalies([])).toEqual({ passed: true, score: 100, anomalies: [] });
  });

  it('fails on any critical and weights severities', () => {
    const result = scoreAnomalies([
      anomaly({ severity: 'critical' }),
      anomaly({ severity: 'warning', type: 'HARDCODED_LEAK' }),
      anomaly({ severity: 'info', type: 'LINE_LENGTH_EXCESS' }),
    ]);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(100 - 25 - 5);
  });

  it('floors the score at zero', () => {
    const result = scoreAnomalies(Array.from({ length: 10 }, () => anomaly()));
    expect(result.score).toBe(0);
  });
});

describe('TypographyVerifier.heal', () => {
  const verifier = new TypographyVerifier();
  const overflow = scoreAnomalies([anomaly()]);
  const clean = scoreAnomalies([]);

  it('leaves a clean spec untouched', () => {
    expect(verifier.heal(SPEC, clean)).toEqual(SPEC);
  });

  it('steps density down before touching sizes', () => {
    expect(verifier.heal(SPEC, overflow).density).toBe('comfortable');
    const compacted = verifier.heal({ ...SPEC, density: 'comfortable' }, overflow);
    expect(compacted.density).toBe('compact');
    expect(compacted.baseSizeMaxPx).toBe(SPEC.baseSizeMaxPx);
  });

  it('shrinks the fluid ceiling once density bottoms out', () => {
    const healed = verifier.heal({ ...SPEC, density: 'compact' }, overflow);
    expect(healed.baseSizeMaxPx).toBeCloseTo(16.5, 5);
    expect(healed.ratio).toBe(SPEC.ratio);
  });

  it('never shrinks below the floor', () => {
    const healed = verifier.heal({ ...SPEC, density: 'compact', baseSizeMaxPx: 15 }, overflow);
    expect(healed).toEqual({ ...SPEC, density: 'compact', baseSizeMaxPx: 15 });
  });

  it('evaluates through an injected observer and frame', async () => {
    const seen: NodeAnomaly[] = [anomaly({ severity: 'warning', type: 'HARDCODED_LEAK' })];
    const fake = { observe: () => seen } as unknown as ConstructorParameters<typeof TypographyVerifier>[0];
    const result = await new TypographyVerifier(fake).evaluate(SPEC, () => Promise.resolve());
    expect(result).toEqual({ passed: true, score: 95, anomalies: seen });
  });
});
