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
export const AXE_DEBT_BY_ROUTE: Readonly<Record<string, readonly AxeDebtBaseline[]>> = {};

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
