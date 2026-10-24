import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  _scanSourceForTest,
  scanChargerIdentityGuard,
  scanIconAdoptionGuard,
  scanIncompleteBetaGuard,
  scanTimezoneGuard,
  scanUiAdoptionGuard,
  scanUnitFactorGuard,
} from '../shared-pattern-guards.mjs';

const rules = (findings) => findings.map((finding) => finding.rule);

test('SP-1 rejects a second local incomplete-beta implementation', () => {
  const source = `
    function betacf(x, a, b) { return x; }
    export function regularizedIncompleteBeta(x, a, b) { return x; }
    export function betaQuantile(p, a, b) { return p; }
  `;
  const findings = scanIncompleteBetaGuard(source, { rel: 'src/features/analytics/lib/stats.ts' });
  assert.deepEqual(rules(findings), ['SP-1', 'SP-1', 'SP-1']);
});

test('SP-1 allows imports and callers of the canonical statistics module', () => {
  const source = `
    import { betaQuantile, regularizedIncompleteBeta } from '@/lib/statistics';
    const mean = regularizedIncompleteBeta(0.4, 2, 3);
    const median = betaQuantile(0.5, 2, 3);
  `;
  assert.deepEqual(scanIncompleteBetaGuard(source, { rel: 'src/features/analytics/lib/stats.ts' }), []);
});

test('SP-2 pins all three charger identity adopters', () => {
  const cases = [
    ['src/features/charging/lib/chargeInterruption.ts', 'export function groupSiteKey() {}'],
    ['src/features/charging/lib/chargerHealth.ts', 'export function siteKeyOf() {}'],
    ['src/features/charging/lib/chargerResilience.ts', 'export function resolveResilienceSite() {}'],
  ];
  for (const [rel, source] of cases) {
    assert.ok(scanChargerIdentityGuard(source, { rel }).length > 0, rel);
  }
});

test('SP-2 accepts canonical import and call in each charger adopter', () => {
  for (const [rel, name] of [
    ['src/features/charging/lib/chargeInterruption.ts', 'groupSiteKey'],
    ['src/features/charging/lib/chargerHealth.ts', 'siteKeyOf'],
    ['src/features/charging/lib/chargerResilience.ts', 'resolveResilienceSite'],
  ]) {
    const source = `
      import { normalizePlaceGeoSite } from './siteIdentity';
      export function ${name}(session) { return normalizePlaceGeoSite(session); }
    `;
    assert.deepEqual(scanChargerIdentityGuard(source, { rel }), []);
  }
});

test('SP-10 rejects direct feature lucide imports and route-local icon maps', () => {
  const findings = scanIconAdoptionGuard(`
    import { Zap } from 'lucide-react';
    const iconMap = { charging: Zap };
    export const icon = iconMap;
  `, { rel: 'src/features/charging/pages/PowerPage.tsx' });
  assert.deepEqual(rules(findings), ['SP-10', 'SP-10']);
});

test('SP-10 accepts Icons registry concepts', () => {
  const source = `
    import { Icons } from '@/lib/icons';
    export const Charging = Icons.charging;
  `;
  assert.deepEqual(scanIconAdoptionGuard(source, { rel: 'src/features/charging/pages/PowerPage.tsx' }), []);
});

test('SP-11 rejects inline timezone arithmetic and new Date locale formatting', () => {
  const source = `
    const label = new Date().toLocaleString();
    const noon = new Date('2026-01-01');
    noon.setHours(12, 0, 0, 0);
    const offset = noon.getTimezoneOffset();
  `;
  const findings = scanTimezoneGuard(source, { rel: 'src/features/settings/pages/Display.tsx' });
  assert.ok(findings.some((finding) => finding.fix.includes('dateFormat')));
  assert.ok(findings.some((finding) => finding.fix.includes('timezone arithmetic')));
});

test('SP-11 allows shared date modules', () => {
  const source = `
    import { formatDateTime } from '@/lib/dateFormat';
    export const label = formatDateTime(new Date());
  `;
  assert.deepEqual(scanTimezoneGuard(source, { rel: 'src/features/settings/pages/Display.tsx' }), []);
});

test('SP-12 rejects inline conversion factors and legacy unit suffix names', () => {
  const factors = scanUnitFactorGuard(`
    const miles = meters / 1609.344;
    const kilometers = meters / 1000;
  `, { rel: 'src/features/driving/pages/Distance.tsx' });
  assert.ok(rules(factors).every((rule) => rule === 'SP-12'));
  assert.ok(factors.length >= 2);

  const legacy = scanUnitFactorGuard(`
    const distance_mi = 10;
    const energyUsedKwh = 12;
  `, { rel: 'src/features/charging/pages/Cost.tsx' });
  assert.ok(legacy.length >= 1);
});

test('SP-12 allows canonical conversion helpers and canonical SI names', () => {
  const source = `
    import { metersToMiles } from '@/lib/unitConversion';
    const distanceM = 16090;
    export const miles = metersToMiles(distanceM);
  `;
  assert.deepEqual(scanUnitFactorGuard(source, { rel: 'src/features/driving/pages/Distance.tsx' }), []);
});

test('SP-13 rejects raw HTML, direct libraries, double API prefixes, routes, and localStorage', () => {
  const source = `
    import { LineChart } from 'recharts';
    const page = <button onClick={() => navigate('/charger-health')}>Go</button>;
    const route = '/api/v1/vehicles';
    localStorage.setItem('page', 'charging');
  `;
  const findings = scanUiAdoptionGuard(source, { rel: 'src/features/charging/pages/PowerPage.tsx' });
  assert.ok(findings.some((finding) => finding.fix.includes('Button')));
  assert.ok(findings.some((finding) => finding.fix.includes('components/charts')));
  assert.ok(findings.some((finding) => finding.fix.includes('/api/v1')));
  assert.ok(findings.some((finding) => finding.fix.includes('route registry')));
  assert.ok(findings.some((finding) => finding.fix.includes('shared storage')));
});

test('SP-13 rejects static CSS-variable inline styles without exception markers', () => {
  const source = `
    export const page = <div style={{ color: 'var(--text-primary)', background: 'var(--surface-2)' }}>Text</div>;
  `;
  const findings = scanUiAdoptionGuard(source, { rel: 'src/features/settings/pages/Profile.tsx' });
  assert.ok(findings.some((finding) => finding.fix.includes('Tailwind class')));
});

test('SP-13 accepts shared components, barrel imports, hook-relative routes, and typed storage helpers', () => {
  const source = `
    import { Button } from '@/components/ui';
    import { LineChart } from '@/components/charts';
    import { routePath } from '@/lib/routeRegistry';
    export const page = <Button onClick={() => navigate(routePath('chargerHealth'))}>Go</Button>;
  `;
  assert.deepEqual(scanUiAdoptionGuard(source, { rel: 'src/features/charging/pages/PowerPage.tsx' }), []);
});

test('combined scanner selects precise guard families', () => {
  const findings = _scanSourceForTest(`
    import { Zap } from 'lucide-react';
    const label = new Date().toLocaleDateString();
  `, { rel: 'src/features/charging/pages/PowerPage.tsx', guards: ['SP-10', 'SP-11'] });
  assert.deepEqual(rules(findings).sort(), ['SP-10', 'SP-11']);
});
