import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('thermal tax category import adoption', () => {
  it.each([
    ['ThermalPhases.tsx', 'LayoutCard', '@/components/layout'],
    ['ThermalPowerChart.tsx', 'useCardPlacement', '@/components/layout'],
    ['ThermalTaxStats.tsx', 'type StatMetric, type StatPeriod', '@/components/data-display'],
  ])('keeps %s on the existing public category boundary', (file, symbols, category) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    expect(source).toContain(`import { ${symbols} } from '${category}';`);
    expect(source).not.toMatch(/from ['"]@\/components\/(?:layout\/layout-reference|data-display\/stat-reference)/);
  });

  it('retains the same card and placement implementations without an adapter', () => {
    const source = readFileSync(resolve('src', 'components', 'layout', 'index.ts'), 'utf8');
    expect(source).toContain("export { LayoutCard, type LayoutCardProps } from './layout-reference/LayoutCard';");
    expect(source).toContain("export { useCardPlacement } from './layout-reference/CardPlacementContext';");
  });

  it('uses the existing metric and period type exports without adding a public adapter', () => {
    const source = readFileSync(resolve('src', 'components', 'data-display', 'index.ts'), 'utf8');
    expect(source).toContain("export type { StatStripProps, StatGroupProps, StatMetric } from './stat-reference/types';");
    expect(source).toContain("export type { StatPeriod, MetricPreferences, MetricId } from '@/lib/metric-reference';");
  });
});
