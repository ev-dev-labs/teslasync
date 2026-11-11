import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { Evidence } from '@/types/advancedIntelligence';
import { EvidencePanel } from './EvidencePanel';

function stylesheet(...names: string[]) {
  const rules: Rule[] = [];
  postcss.parse(readFileSync(
    resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', ...names), 'utf8',
  )).walkRules(rule => { rules.push(rule); });
  return rules;
}

const baseRules = stylesheet('base.css');
const feedbackRules = stylesheet('feedback.css');

function consumes(node: Element, rules: readonly Rule[], contract: string, property?: string) {
  return rules.some(rule => rule.selector.includes(contract) && node.matches(rule.selector)
    && rule.nodes.some(declaration => declaration.type === 'decl'
      && (property === undefined || declaration.prop === property)));
}

const evidence: Evidence[] = [
  { source: 'Long-source-identity-'.repeat(8), summary: 'Returned observation, not a causal conclusion. '.repeat(5),
    sample_count: 0, observed_at: '2026-01-15T00:30:00Z' },
  { source: 'Unknown-count-source', summary: 'Samples and observation time were not supplied.',
    sample_count: null, observed_at: null },
];

describe('EvidencePanel actual design consumers (source-only)', () => {
  it.each(PACK_IDS)('%s owns the actual source records and unsupported notice without fabricating readings', pack => {
    const original = structuredClone(evidence);
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <EvidencePanel evidence={evidence} limitations={['Observed association only.']}
          unsupported={['No identity attribution.', 'No operational command execution.']} />
      </div>,
    );
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const sourceSection = screen.getByRole('region', { name: 'Evidence sources' });
      const records = sourceSection.querySelectorAll('[data-app-list="definitions"] > [data-app-part~="list-row"]');
      expect(records).toHaveLength(2);
      for (const [index, record] of Array.from(records).entries()) {
        expect(record).toHaveAttribute('data-surface-variant', 'standalone');
        expect(consumes(record, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
        expect(consumes(record, stylesheet('packs', `${pack}.css`), '[data-app-part~="card"]')).toBe(true);
        expect(consumes(record, feedbackRules, `[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`, 'display')).toBe(true);
        expect(within(record as HTMLElement).getByRole('term')).toHaveTextContent(evidence[index].source);
        const summary = record.querySelector('[data-app-part~="metric-reading"]')!;
        expect(summary).toHaveTextContent(evidence[index].summary.trim());
        expect(consumes(summary, feedbackRules, '[data-app-list="definitions"]', 'display')).toBe(true);
        const context = record.querySelector('[data-app-part~="metric-context"]')!;
        expect(consumes(context, feedbackRules, '[data-app-part~="metric-context"]', 'white-space')).toBe(true);
      }
      expect(records[0]).toHaveTextContent('0 samples');
      expect(records[1].querySelector('[data-app-part~="metric-context"]')).toHaveTextContent('—');
      expect(records[1]).not.toHaveTextContent('0 samples');
      const notice = screen.getByText('Explicitly unsupported').closest('[data-app-feedback-kind="notice"]')!;
      expect(notice).toHaveAttribute('data-app-tone', 'warning');
      expect(consumes(notice, feedbackRules, `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`, 'border')).toBe(true);
      expect(notice.querySelector('[data-app-part~="feedback-content"] > [data-app-part~="feedback-title"]'))
        .toHaveTextContent('Explicitly unsupported');
      expect(notice.querySelectorAll('[data-app-part~="feedback-message"]')).toHaveLength(2);
      expect(notice).toHaveTextContent('No operational command execution.');
      expect(screen.getByText('• Observed association only.')).toBeVisible();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(evidence).toEqual(original);
    } finally {
      release();
    }
  });

  it('leaves unselected sources unowned and keeps conditional-off unsupported content absent', () => {
    const { container, rerender } = render(<EvidencePanel evidence={evidence} unsupported={[]} />);
    const release = observeAppDesignScopes(container);
    try {
      expect(container.querySelector('[data-app-design-owner]')).toBeNull();
      expect(container.querySelector('[data-app-feedback-kind="notice"]')).toBeNull();
      expect(screen.queryByText('Explicitly unsupported')).not.toBeInTheDocument();
      rerender(<EvidencePanel evidence={[]} unsupported={null} />);
      expect(screen.getByText('No supporting evidence was returned.')).toBeVisible();
      expect(container.querySelector('[data-app-part~="list-row"]')).toBeNull();
      expect(container.querySelector('[data-app-feedback-kind="notice"]')).toBeNull();
      for (const name of ['Data quality', 'Evidence sources', 'Limitations']) {
        expect(screen.getByRole('region', { name })).toBeVisible();
      }
    } finally {
      release();
    }
  });
});
