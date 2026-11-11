import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { analyzeSleepEfficiency } from '../../lib/sleepEfficiencyAnalysis';
import { SleepMethodologyPanel } from './SleepMethodologyPanel';
import type { SleepEfficiencySectionProps } from './types';

const state: SleepEfficiencySectionProps['state'] = {
  vehicleSelected: true, isLoading: false, isResolved: true,
  error: null, refreshError: null, onRetry: vi.fn(),
};

function analysis(now = Date.parse('2026-08-08T12:00:00Z'), populated = false) {
  return analyzeSleepEfficiency(
    populated ? { state_distribution: [{ state: 'asleep', count: 4, total_minutes: 45 }] } : undefined,
    now, '2026-08-01', '2026-08-08',
  );
}

describe('SleepMethodologyPanel native surfaces', () => {
  it('keeps both complete evidence cards and the independent warning as evidence changes', () => {
    const view = render(<SleepMethodologyPanel analysis={analysis()} state={state} />);
    const cards = ['Current evidence model', 'Context and future evidence'].map(title =>
      screen.getByRole('heading', { name: title }).closest('[data-app-part="card"]')!,
    );
    for (const card of cards) {
      expect(card).toHaveAttribute('data-surface-variant', 'standalone');
      expect(within(card as HTMLElement).getAllByRole('listitem')).toHaveLength(4);
    }
    expect(screen.getByText(/it is not occupancy or duration/)).toBeInTheDocument();
    expect(screen.getByText(/not statistical confidence or model accuracy/)).toBeInTheDocument();
    view.rerender(<SleepMethodologyPanel analysis={analysis(Number.NaN, true)} state={state} />);
    expect(screen.getByText(/supplied frozen clock is invalid/)).toBeInTheDocument();
    expect(screen.getByText(/No panel makes battery-wear/)).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(view.container.querySelectorAll('[data-app-part="card"]')).toHaveLength(2);
  });

  it('activates real surface rules on the two native hosts for all 27 profiles, not their prose', () => {
    const { container } = render(<SleepMethodologyPanel analysis={analysis()} state={state} />);
    container.setAttribute('data-app-design-preview', '');
    const cards = [...container.querySelectorAll('[data-app-part="card"]')];
    expect(cards).toHaveLength(2);
    expect(cards.every(card => !card.hasAttribute('data-app-design-owner'))).toBe(true);
    for (const pack of PACK_IDS) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
      const release = observeAppDesignScopes(container);
      try {
        const sheet = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', `${pack}.css`), 'utf8'));
        const consumed = new Set<Element>();
        sheet.walkRules(rule => {
          if (!rule.selector.includes('[data-app-part~="card"]') ||
            !rule.nodes.some(node => node.type === 'decl' && node.prop.startsWith('border'))) return;
          for (const element of container.querySelectorAll(rule.selector)) if (cards.includes(element)) consumed.add(element);
        });
        expect(consumed.size, pack).toBe(2);
        for (const card of cards) expect(card).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
        expect(container.querySelectorAll('li[data-app-part~="card"]')).toHaveLength(0);
      } finally {
        release();
      }
    }
  });
});
