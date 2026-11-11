import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type Rule } from 'postcss';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';
import { StatGrid } from './StatGrid';

const rules: Rule[] = [];
parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => { rules.push(rule); });

describe('Ownership specialist stat presentation', () => {
  it.each(['classic', 'v3', 'v2', 'v1'] as const)('%s composes caller-owned readings through its deliberate data consumer', pack => {
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <StatGrid columns={2} stats={[
          { key: 'replacement', label: 'Replacement cost', value: '€0.00', state: 'value' },
          { key: 'wear', label: 'Part wear cost', value: '—', state: 'missing', hint: 'per 1 000 metres driven' },
          { key: 'invalid', label: 'Invalid source', value: '—', state: 'invalid' },
          { key: 'rich', label: 'Caller formatted', value: <em>GBP 1,234.50</em> },
        ]} />
      </div>,
    );
    const grid = container.querySelector('[data-app-part~="metric-grid"]')!;
    const tiles = grid.querySelectorAll(':scope > [data-app-metric="tile"]');
    expect(tiles).toHaveLength(4);
    expect(grid).toHaveClass('grid-cols-1', 'sm:grid-cols-2', 'gap-3');
    expect(tiles[0]).not.toHaveAttribute('data-app-design-owner');
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const mode = APPLICATION_DESIGNS[pack].data;
      expect(rules.some(rule => rule.selector.includes(`[data-app-data="${mode}"]`)
        && rule.selector.includes('[data-app-metric="tile"]')
        && rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === 'padding')
        && Array.from(container.ownerDocument.querySelectorAll(rule.selector)).includes(tiles[0]))).toBe(true);
      expect(tiles[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('€0.00');
      expect(tiles[0]).toHaveAttribute('data-state', 'value');
      expect(tiles[1]).toHaveAttribute('data-state', 'missing');
      expect(tiles[1].querySelector('[data-app-part~="metric-context"]')).toHaveTextContent('per 1 000 metres driven');
      expect(tiles[2]).toHaveAttribute('data-state', 'invalid');
      expect(tiles[3].querySelector('[data-app-part~="metric-value"] > em')).toHaveTextContent('GBP 1,234.50');
      expect(tiles[3]).not.toHaveAttribute('data-state');
    } finally {
      release();
    }
    expect(grid).not.toHaveAttribute('data-app-design-owner');
  });

  it('retains caller order, formatted currency, unknown readings, real zero, hints and rich values', () => {
    const { container } = render(
      <StatGrid columns={3} stats={[
        { key: 'money', label: 'Liability', value: '€12.37', hint: 'Entered billing period' },
        { key: 'missing', label: 'Unknown coverage', value: '—' },
        { key: 'zero', label: 'Real zero', value: 0 },
        { key: 'rich', label: 'Independent comparison', value: <span>+4% vs baseline</span>, tone: 'warning' },
      ]} />,
    );
    expect(screen.getByText('€12.37')).toBeInTheDocument();
    expect(screen.getByText('Entered billing period')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('+4% vs baseline')).toBeInTheDocument();
    expect(container.textContent?.indexOf('Liability')).toBeLessThan(container.textContent?.indexOf('Unknown coverage') ?? 0);
    expect(container.textContent?.indexOf('Unknown coverage')).toBeLessThan(container.textContent?.indexOf('Real zero') ?? 0);
    expect(container.textContent?.indexOf('Real zero')).toBeLessThan(container.textContent?.indexOf('Independent comparison') ?? 0);
  });
});
