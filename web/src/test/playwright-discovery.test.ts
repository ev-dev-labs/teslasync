import { describe, expect, it } from 'vitest';
import { baseConfig } from '../../playwright.config';

const supportedFamilies = [
  'battery-cycle-stress',
  'battery-charge-advisor',
  'battery-sleep-retention',
  'specialized-home-energy',
  'specialized-resale',
  'specialized-diagnostics',
  'vehicle-systems-preconditioning',
];

function smokeMatches(path: string): boolean {
  const project = baseConfig.projects?.find(candidate => candidate.name === 'chromium-smoke');
  expect(project).toBeDefined();
  const matchers = [project?.testMatch].flat();
  const ignored = [project?.testIgnore].flat();
  return matchers.some(matcher => matcher instanceof RegExp && matcher.test(path))
    && !ignored.some(matcher => matcher instanceof RegExp && matcher.test(path));
}

describe('OperationalBrief supported scenario discovery', () => {
  it.each(supportedFamilies)('includes %s on both filesystem path styles', family => {
    expect(smokeMatches(`e2e/operationalbrief-contracts/${family}.supported.spec.ts`)).toBe(true);
    expect(smokeMatches(`e2e\\operationalbrief-contracts\\${family}.supported.spec.ts`)).toBe(true);
  });

  it('preserves existing smoke discovery and dedicated project exclusions', () => {
    expect(smokeMatches('e2e/operationalbrief-contracts/battery.smoke.spec.ts')).toBe(true);
    expect(smokeMatches('e2e/accessibility.smoke.spec.ts')).toBe(false);
    expect(smokeMatches('e2e/performance.perf.spec.ts')).toBe(false);
  });

  it('does not discover fixtures or unrelated supported specifications', () => {
    expect(smokeMatches('e2e/operationalbrief-contracts/battery-sleep-retention.supported.fixtures.ts')).toBe(false);
    expect(smokeMatches('e2e/unrelated.supported.spec.ts')).toBe(false);
  });
});
