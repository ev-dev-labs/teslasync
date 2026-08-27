import type { Result } from 'axe-core';

export interface AxeDebtBaseline {
  rule: string;
  targets: readonly string[];
  owner: string;
  tracking: string;
}

/**
 * Temporary, exact accessibility debt. Each selector is a reviewed production
 * violation; additions or removals fail until this list is deliberately
 * reconciled. Rules absent from this list remain zero-tolerance.
 */
export const AXE_DEBT_BY_ROUTE: Readonly<Record<string, readonly AxeDebtBaseline[]>> = {
  '/': [
    {
      rule: 'color-contrast',
      targets: [
      '.border-e.last\\:border-e-0.sm\\:border-b-0:nth-child(1) > .block.mt-1.text-xs',
      '.border-e.last\\:border-e-0.sm\\:border-b-0:nth-child(1) > dt',
      '.border-e.last\\:border-e-0.sm\\:border-b-0:nth-child(2) > .block.mt-1.text-xs',
      '.border-e.last\\:border-e-0.sm\\:border-b-0:nth-child(2) > dt',
      '.border-e.last\\:border-e-0.sm\\:border-b-0:nth-child(3) > .block.mt-1.text-xs',
      '.border-e.last\\:border-e-0.sm\\:border-b-0:nth-child(3) > dt',
      '.border-e.last\\:border-e-0.sm\\:border-b-0:nth-child(4) > .block.mt-1.text-xs',
      '.border-e.last\\:border-e-0.sm\\:border-b-0:nth-child(4) > dt',
      '[aria-label="Search pages, commands…"] > .text-left',
      '.shadow-sm > span',
      ],
      owner: 'navigation/design-system',
      tracking: 'A11Y-contrast-wave-1',
    },
    {
      rule: 'definition-list',
      targets: ['dl'],
      owner: 'dashboard',
      tracking: 'A11Y-definition-list-wave-1',
    },
  ],
  '/vehicles': [{
    rule: 'color-contrast',
    targets: [
      '.border-transparent',
      '[aria-label="Search pages, commands…"] > .text-left',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(1) > .line-clamp-2.mt-1.text-2xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(1) > .tracking-wider.uppercase.text-xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(2) > .line-clamp-2.mt-1.text-2xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(2) > .tracking-wider.uppercase.text-xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(3) > .line-clamp-2.mt-1.text-2xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(3) > .tracking-wider.uppercase.text-xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(4) > .line-clamp-2.mt-1.text-2xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(4) > .tracking-wider.uppercase.text-xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(5) > .line-clamp-2.mt-1.text-2xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(5) > .tracking-wider.uppercase.text-xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(6) > .line-clamp-2.mt-1.text-2xs',
      '.p-3.sm\\:p-4[role="listitem"]:nth-child(6) > .tracking-wider.uppercase.text-xs',
    ],
    owner: 'vehicles/design-system',
    tracking: 'A11Y-contrast-wave-1',
  }],
  '/data-repair': [{
    rule: 'color-contrast',
    targets: [
      '[aria-label="Search pages, commands…"] > .text-left',
      '.text-\\[var\\(--theme-on-primary\\)\\]',
      'th[data-column-key="actions"] > .gap-1.inline-flex > .gap-1.inline-flex',
      'th[data-column-key="assigned_to"] > .gap-1.inline-flex > .gap-1.inline-flex',
      'th[data-column-key="case"] > .gap-1.inline-flex > .gap-1.inline-flex',
      'th[data-column-key="confidence"] > .gap-1.inline-flex > .gap-1.inline-flex',
      'th[data-column-key="last_seen_at"] > .gap-1.inline-flex > .gap-1.inline-flex',
      'th[data-column-key="rule"] > .gap-1.inline-flex > .gap-1.inline-flex',
      'th[data-column-key="status"] > .gap-1.inline-flex > .gap-1.inline-flex',
    ],
    owner: 'data-repair/design-system',
    tracking: 'A11Y-contrast-wave-1',
  }],
};

export function axeTargets(results: readonly Result[], rule: string): string[] {
  return results
    .filter((result) => result.id === rule)
    .flatMap((result) => result.nodes.map((node) => normalizeAxeTarget(node.target.join(' > '))))
    .sort();
}

function normalizeAxeTarget(target: string): string {
  if (target.includes('[aria-label="Search pages, commands…"]')) {
    return '[aria-label="Search pages, commands…"] > .text-left';
  }
  return target;
}
