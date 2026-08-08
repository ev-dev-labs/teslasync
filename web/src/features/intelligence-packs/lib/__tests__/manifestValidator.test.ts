import { describe, it, expect } from 'vitest';
import { parseSignedEnvelope, checkStructuralLimits, parseJsonWithSizeLimit } from '../manifestValidator';
import { MANIFEST_LIMITS } from '../manifestTypes';
import { EFFICIENCY_INSIGHTS_ENVELOPE, COMMUNITY_DRAFT_ENVELOPE } from '../catalogFixtures';

function validEnvelopeObj() {
  return JSON.parse(JSON.stringify(EFFICIENCY_INSIGHTS_ENVELOPE));
}

describe('parseJsonWithSizeLimit', () => {
  it('accepts small, valid JSON', () => {
    const result = parseJsonWithSizeLimit('{"a":1}');
    expect(result.ok).toBe(true);
  });

  it('rejects non-JSON text', () => {
    const result = parseJsonWithSizeLimit('not json{{{');
    expect(result.ok).toBe(false);
  });

  it('rejects oversized input before parsing', () => {
    const huge = '{"a":"' + 'x'.repeat(MANIFEST_LIMITS.maxEnvelopeJsonBytes + 10) + '"}';
    const result = parseJsonWithSizeLimit(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/bytes/i);
  });
});

describe('checkStructuralLimits', () => {
  it('accepts reasonably shaped data', () => {
    expect(checkStructuralLimits({ a: [1, 2, 3], b: { c: 'x' } })).toBeNull();
  });

  it('rejects excessive nesting depth without a stack overflow', () => {
    let node: unknown = 1;
    for (let i = 0; i < MANIFEST_LIMITS.maxJsonDepth + 50; i++) node = [node];
    expect(() => checkStructuralLimits(node)).not.toThrow();
    expect(checkStructuralLimits(node)).toMatch(/nesting/i);
  });

  it('rejects excessive node counts', () => {
    // Build many small nested objects (each under the array/string-length
    // ceilings) so this specifically trips the total-node-count limit
    // rather than the array-length limit.
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < MANIFEST_LIMITS.maxJsonNodeCount + 10; i++) obj[`k${i}`] = i;
    expect(checkStructuralLimits(obj)).toMatch(/nodes/i);
  });

  it('rejects overlong strings', () => {
    expect(checkStructuralLimits('x'.repeat(MANIFEST_LIMITS.maxStringLength + 1))).toMatch(/string/i);
  });

  it('rejects overlong arrays', () => {
    const arr = Array.from({ length: MANIFEST_LIMITS.maxArrayLength + 1 }, () => 1);
    expect(checkStructuralLimits(arr)).toMatch(/array/i);
  });
});

describe('parseSignedEnvelope — happy paths', () => {
  it('parses the bundled signed fixture successfully', () => {
    const result = parseSignedEnvelope(JSON.stringify(EFFICIENCY_INSIGHTS_ENVELOPE));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.id).toBe('efficiency-insights-starter');
      expect(result.value.signature?.algorithm).toBe('Ed25519');
    }
  });

  it('parses the unsigned community draft successfully', () => {
    const result = parseSignedEnvelope(JSON.stringify(COMMUNITY_DRAFT_ENVELOPE));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.signature).toBeNull();
  });
});

describe('parseSignedEnvelope — malformed schema rejection', () => {
  it('rejects an unknown top-level envelope field', () => {
    const obj = validEnvelopeObj();
    obj.extraField = 'nope';
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects an unsupported schemaVersion', () => {
    const obj = validEnvelopeObj();
    obj.manifest.schemaVersion = 999;
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/schemaVersion/);
  });

  it('rejects an unsupported envelopeVersion', () => {
    const obj = validEnvelopeObj();
    obj.envelopeVersion = 2;
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a manifest.id that is not a valid slug', () => {
    const obj = validEnvelopeObj();
    obj.manifest.id = 'Not A Valid Id!!';
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-semver manifest.version', () => {
    const obj = validEnvelopeObj();
    obj.manifest.version = 'v1';
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown field inside a coefficient', () => {
    const obj = validEnvelopeObj();
    obj.manifest.coefficients[0].bogus = true;
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a coefficient whose value is outside [min, max]', () => {
    const obj = validEnvelopeObj();
    obj.manifest.coefficients[0].value = obj.manifest.coefficients[0].max + 1000;
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a coefficient with min > max', () => {
    const obj = validEnvelopeObj();
    obj.manifest.coefficients[0].min = 1000;
    obj.manifest.coefficients[0].max = 1;
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a duplicate coefficient name', () => {
    const obj = validEnvelopeObj();
    obj.manifest.coefficients.push({ ...obj.manifest.coefficients[0] });
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a duplicate formula id', () => {
    const obj = validEnvelopeObj();
    obj.manifest.formulas.push({ ...obj.manifest.formulas[0] });
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a dashboard widget referencing an unknown formulaRef', () => {
    const obj = validEnvelopeObj();
    obj.manifest.dashboards[0].widgets[0].formulaRef = 'does-not-exist';
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a dashboard widget kind outside the visualization allowlist', () => {
    const obj = validEnvelopeObj();
    obj.manifest.dashboards[0].widgets[0].kind = 'pie-3d-explosion';
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a malformed signature block (bad base64)', () => {
    const obj = validEnvelopeObj();
    obj.signature.publicKeyBase64 = 'not base64!!';
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a manifest.publisher.fingerprint that is not 64 lowercase hex chars', () => {
    const obj = validEnvelopeObj();
    obj.manifest.publisher.fingerprint = 'ZZZ-not-a-fingerprint';
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects too many formulas', () => {
    const obj = validEnvelopeObj();
    const template = obj.manifest.formulas[0];
    obj.manifest.formulas = Array.from({ length: MANIFEST_LIMITS.maxFormulas + 1 }, (_, i) => ({
      ...template,
      id: `${template.id}-${i}`,
    }));
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects capabilities outside the allowlist (structurally impossible request)', () => {
    const obj = validEnvelopeObj();
    obj.manifest.capabilities.push('write:vehicle-command');
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });
});

describe('parseSignedEnvelope — expression AST safety (capability/expression tests)', () => {
  it('rejects an unknown expression operator', () => {
    const obj = validEnvelopeObj();
    obj.manifest.formulas[0].expr = { op: 'eval', code: 'alert(1)' };
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a field reference not in the sample-data allowlist', () => {
    const obj = validEnvelopeObj();
    obj.manifest.formulas[0].expr = { op: 'field', name: 'vin_number' };
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects a coef reference to an undeclared coefficient', () => {
    const obj = validEnvelopeObj();
    obj.manifest.formulas[0].expr = { op: 'coef', name: 'nonexistent_coefficient' };
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects an expression tree exceeding the per-formula node budget', () => {
    const obj = validEnvelopeObj();
    let expr: unknown = { op: 'const', value: 1 };
    for (let i = 0; i < MANIFEST_LIMITS.maxExprNodesPerFormula + 5; i++) {
      expr = { op: 'abs', arg: expr };
    }
    obj.manifest.formulas[0].expr = expr;
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects an expression tree exceeding the per-formula depth budget', () => {
    const obj = validEnvelopeObj();
    let expr: unknown = { op: 'const', value: 1 };
    for (let i = 0; i < MANIFEST_LIMITS.maxExprDepth + 5; i++) {
      expr = { op: 'neg', arg: expr };
    }
    obj.manifest.formulas[0].expr = expr;
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('rejects unknown keys inside an expression node', () => {
    const obj = validEnvelopeObj();
    obj.manifest.formulas[0].expr = { op: 'const', value: 1, sneaky: 'field' };
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });

  it('accepts every allowlisted operator at least once (sanity: vocabulary is usable)', () => {
    const obj = validEnvelopeObj();
    obj.manifest.formulas = [
      {
        id: 'kitchen-sink',
        label: 'Kitchen Sink',
        expr: {
          op: 'if',
          cond: { op: 'gt', left: { op: 'field', name: 'battery_level_pct' }, right: { op: 'const', value: 10 } },
          then: {
            op: 'clamp01',
            arg: {
              op: 'avg',
              args: [
                { op: 'abs', arg: { op: 'neg', arg: { op: 'const', value: -1 } } },
                { op: 'round', arg: { op: 'div', args: [{ op: 'const', value: 4 }, { op: 'const', value: 2 }] } },
                { op: 'min', args: [{ op: 'const', value: 1 }, { op: 'const', value: 2 }] },
                { op: 'max', args: [{ op: 'const', value: 1 }, { op: 'const', value: 2 }] },
                { op: 'mul', args: [{ op: 'const', value: 2 }, { op: 'const', value: 3 }] },
                { op: 'sub', args: [{ op: 'const', value: 5 }, { op: 'const', value: 2 }] },
              ],
            },
          },
          else: { op: 'coef', name: obj.manifest.coefficients[0].name },
        },
      },
    ];
    obj.manifest.dashboards = [];
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(true);
  });
});

describe('parseSignedEnvelope — compatibility fields', () => {
  it('accepts a null maxAppVersion (unbounded)', () => {
    const obj = validEnvelopeObj();
    obj.manifest.appCompatibility.maxAppVersion = null;
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(true);
  });

  it('rejects a non-semver minAppVersion', () => {
    const obj = validEnvelopeObj();
    obj.manifest.appCompatibility.minAppVersion = 'not-a-version';
    const result = parseSignedEnvelope(JSON.stringify(obj));
    expect(result.ok).toBe(false);
  });
});
