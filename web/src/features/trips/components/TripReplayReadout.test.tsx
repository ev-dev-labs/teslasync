import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { TripReplayReadout } from './TripReplayReadout';

const compositionRules: Rule[] = [];
// Vitest stubs CSS imports; read real selectors without claiming browser layout.
const feedbackCss = readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8');
postcss.parse(feedbackCss).walkRules(rule => {
  if (/data-app-(metric|part)/.test(rule.selector)) compositionRules.push(rule);
});

describe('TripReplayReadout', () => {
  it('keeps long prepared labels, values, units and decorative icons in an unframed readout', () => {
    const label = 'A long localized remaining-range label';
    const { container } = render(
      <TripReplayReadout
        label={label}
        value="123.45"
        unit="km"
        icon={<svg data-testid="readout-icon" />}
        className="ring-1 ring-amber-300/40"
      />,
    );
    expect(screen.getByText(label)).toHaveClass('break-words');
    expect(screen.getByText('123.45')).toHaveTextContent('123.45km');
    expect(screen.getByText('km')).toBeInTheDocument();
    expect(screen.getByTestId('readout-icon').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.firstElementChild).toHaveAttribute('data-app-part', 'metric');
    expect(container.firstElementChild).toHaveAttribute('data-app-metric', 'tile');
    expect(container.firstElementChild).toHaveClass('min-w-0', 'px-3', 'py-3', 'sm:px-4', 'ring-1', 'ring-amber-300/40');
    expect(screen.getByText(label).closest('[data-app-part="metric-label"]')?.parentElement).toBe(container.firstElementChild);
    expect(screen.getByText('123.45')).toHaveAttribute('data-app-part', 'metric-value');
    expect(screen.getByText('km')).toHaveAttribute('data-app-part', 'metric-unit');
    expect(container.querySelector('[data-print-card]')).toBeNull();
  });

  it('retains the prepared unknown reading without manufacturing a unit', () => {
    const { container } = render(<TripReplayReadout label="Power" value="—" icon={<svg />} />);
    expect(screen.getByText('—')).toHaveAttribute('data-app-part', 'metric-value');
    expect(container.querySelector('[data-app-part="metric-unit"]')).toBeNull();
  });

  it.each(PACK_IDS)('connects the actual %s data-mode selectors to the existing readout nodes', packId => {
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(packId)}>
        <TripReplayReadout label="Range" value="123.45" unit="km" icon={<svg />} />
      </div>,
    );
    const host = container.firstElementChild as HTMLElement;
    const release = observeAppDesignScopes(host);
    try {
      const tile = host.querySelector('[data-app-metric="tile"]')!;
      const label = tile.querySelector('[data-app-part="metric-label"]')!;
      const value = tile.querySelector('[data-app-part="metric-value"]')!;
      const unit = tile.querySelector('[data-app-part="metric-unit"]')!;
      const dataMode = APPLICATION_DESIGNS[packId].data;
      const tileRules = compositionRules.filter(rule =>
        rule.selector.includes('[data-app-metric="tile"]') &&
        (rule.selector.includes(`[data-app-data="${dataMode}"]`) ||
          rule.selector.includes(`[data-app-design-owner~="data-${dataMode}"]`)) &&
        [...host.querySelectorAll(rule.selector)].includes(tile),
      );
      expect(tileRules.length).toBeGreaterThan(0);
      for (const [node, property] of [[label, 'overflow-wrap'], [value, 'font-variant-numeric'], [unit, 'color']] as const) {
        expect(compositionRules.some(rule =>
          rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === property) &&
          [...host.querySelectorAll(rule.selector)].includes(node),
        )).toBe(true);
      }
      expect(tile.children).toHaveLength(2);
      expect(label.parentElement).toBe(tile);
      expect(value.parentElement).toBe(tile);
      expect(unit.parentElement).toBe(value);
    } finally {
      release();
    }
  });
});
