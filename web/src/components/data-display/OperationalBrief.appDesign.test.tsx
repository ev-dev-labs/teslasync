import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '../ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { OperationalNarrative } from '@/types/operationalNarrative';
import { OperationalBrief } from './OperationalBrief';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (_key: string, fallback: string, options?: Record<string, unknown>) => {
      const template = options?.count === 1
        ? options.defaultValue_one ?? fallback : options?.defaultValue_other ?? fallback;
      return String(template).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
  }),
}));

function stylesheet(name: string) {
  const rules: Rule[] = [];
  postcss.parse(readFileSync(
    resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', name), 'utf8',
  )).walkRules(rule => { rules.push(rule); });
  return rules;
}

const baseRules = stylesheet('base.css');
const feedbackRules = stylesheet('feedback.css');

function consumes(node: Element, rules: readonly Rule[], selector: string, property: string) {
  return rules.some(rule => rule.selector.includes(selector)
    && node.matches(rule.selector)
    && rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === property));
}

const narrative: OperationalNarrative = {
  whatChanged: 'Returned sessions include an interruption.',
  whyItMatters: null,
  likelyCause: null,
  recommendedResponse: null,
  confidence: { label: 'not_scored', score: null, basis: [] },
  limitations: ['Charger diagnostics were not supplied.'],
  evidence: [{
    id: 'session-42',
    summary: 'Session 42 ended before its target.',
    observedAt: '2026-02-20T10:00:00Z',
    provenance: { source: 'Charging history', recordId: '42' },
  }],
  provenance: [{ source: 'Charging history', method: 'Returned session comparison' }],
};

describe('OperationalBrief actual disclosure design consumers (source-only)', () => {
  it.each(PACK_IDS)('%s qualifies the opened records, not just the summary or Drawer ancestor', async pack => {
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <OperationalBrief
          eyebrow="Retained source"
          title="Shared disclosure"
          description="Returned history, not a live health claim."
          statusLabel="Retained"
          showRange
          scope="Returned interval"
          freshness="Last confirmed observation; refresh failed"
          narrative={narrative}
          analysisPeriod="Returned analysis window"
          metrics={[
            { key: 'zero', label: 'Measured zero', value: 0, tone: 'warning',
              detail: <a href="/evidence/42">Read the original source</a> },
            { key: 'pending', label: 'Pending source', value: 913, loading: true,
              detail: 'Waiting for an independent source' },
            { key: 'missing', label: 'Missing source', value: null, detail: 'No observation supplied' },
          ]}
          attention={[
            { key: 'primary', title: 'Source limitation', description: 'Records do not establish cause.', tone: 'warning' },
            { key: 'secondary', title: 'Independent caution', description: 'The time window is incomplete.', tone: 'neutral' },
          ]}
        />
      </div>,
    );
    const host = container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const rangeChip = screen.getByText('Returned interval');
      expect(consumes(rangeChip, feedbackRules, '[data-app-part~="badge"]', 'white-space')).toBe(true);
      const notice = screen.getByText('Source limitation').closest('[data-app-feedback-kind="notice"]')!;
      expect(consumes(notice, feedbackRules,
        `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`, 'border')).toBe(true);
      expect(notice.querySelector('[data-app-part~="feedback-icon"]')).toBeInTheDocument();
      expect(notice.querySelector('[data-app-part~="feedback-content"]')).toHaveTextContent('Records do not establish cause.');
      const opener = screen.getByRole('button', { name: 'Review all' });
      expect(consumes(opener, feedbackRules, '[data-app-part~="feedback-actions"]', 'grid-column')).toBe(true);
      fireEvent.click(opener);
      const dialog = screen.getByRole('dialog', { name: 'Shared disclosure details' });
      const zero = within(dialog).getByRole('group', { name: 'Measured zero' });
      await waitFor(() => expect(zero).toHaveAttribute('data-app-design-owner'));
      expect(consumes(zero, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
      expect(consumes(zero, feedbackRules, `[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`, 'padding')).toBe(true);
      const body = zero.querySelector('[data-app-part~="metric-body"]')!;
      expect(body.querySelector('[data-app-part~="metric-label"]')).toHaveTextContent('Measured zero');
      const value = body.querySelector('[data-app-part~="metric-value"]')!;
      expect(value).toHaveTextContent('0');
      expect(value).toHaveClass('text-[var(--semantic-warning)]');
      expect(consumes(value, feedbackRules, '[data-app-part~="metric-value"]', 'font-variant-numeric')).toBe(true);
      const context = zero.querySelector('[data-app-part~="metric-context"]')!;
      expect(consumes(context, feedbackRules, '[data-app-part~="metric-context"]', 'white-space')).toBe(true);
      expect(within(context as HTMLElement).getByRole('link', { name: 'Read the original source' }))
        .toHaveAttribute('href', '/evidence/42');

      const pending = within(dialog).getByRole('group', { name: 'Pending source' });
      expect(pending).toHaveAttribute('data-app-state', 'loading');
      expect(pending.querySelector('[aria-busy="true"]')).toBeInTheDocument();
      const skeleton = pending.querySelector('[data-app-part~="skeleton"]')!;
      expect(skeleton).toHaveAttribute('aria-hidden', 'true');
      expect(consumes(skeleton, feedbackRules, '[data-app-part~="skeleton"]', 'background-image')).toBe(true);
      expect(within(dialog).queryByText('913')).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('group', { name: 'Missing source' })).not.toBeInTheDocument();
      expect(within(dialog).getByText('1 empty field is hidden.')).toBeInTheDocument();
      expect(within(dialog).getByText('Last confirmed observation; refresh failed')).toBeInTheDocument();

      const attention = within(dialog).getByText('Independent caution').closest('[data-app-feedback-kind="insight"]')!;
      expect(attention).toHaveAttribute('data-app-tone', 'neutral');
      expect(consumes(attention, feedbackRules,
        `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`, 'padding')).toBe(true);
      expect(attention.querySelector('[data-app-part~="feedback-message"]')).toHaveTextContent('The time window is incomplete.');
      const narrativeRegion = within(dialog).getByRole('region', { name: 'Decision narrative' });
      for (const label of ['What changed', 'Why it matters', 'Likely cause', 'Recommended response']) {
        const card = within(narrativeRegion).getByText(label).parentElement!;
        expect(consumes(card, baseRules, '[data-app-part~="card"]', 'box-shadow')).toBe(true);
      }
      expect(within(narrativeRegion).getByText('Cause is not established by the available evidence.')).toBeInTheDocument();
      const evidence = within(narrativeRegion).getByText('Session 42 ended before its target.').parentElement!;
      expect(consumes(evidence, baseRules, '[data-app-part~="card"]', 'border-style')).toBe(true);
      expect(evidence.parentElement).toHaveAttribute('data-app-list', 'sources');
      expect(evidence).toHaveTextContent('Charging history · Record 42');
      const calculation = within(narrativeRegion).getByRole('region', { name: 'How this was calculated' });
      expect(consumes(calculation, baseRules, '[data-app-part~="card"]', 'box-shadow')).toBe(true);
      expect(calculation.querySelectorAll('[data-app-list="definitions"] > [data-app-part~="list-row"]')).toHaveLength(5);
      expect(within(calculation).getByText('Returned analysis window')).toBeInTheDocument();
      expect(within(calculation).getByText('Returned session comparison')).toBeInTheDocument();
      expect(within(calculation).getByText('Charger diagnostics were not supplied.')).toBeInTheDocument();
    } finally {
      release();
    }
  });

  it.each(['classic', 'v2', 'blueprint'] as const)('%s consumes honest empty guidance and existing label chips in both states', async pack => {
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <OperationalBrief eyebrow="Source" title="Unknown readings" description="No measured values."
          statusLabel="Unknown" metrics={[
            { key: 'missing', label: 'Unreported reading', value: null, detail: 'No source observation' },
            { key: 'invalid', label: 'Invalid reading', value: '—', valueState: 'invalid', detail: 'Invalid source value' },
          ]} />
      </div>,
    );
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
      const dialog = screen.getByRole('dialog');
      const empty = dialog.querySelector('[data-app-feedback-kind="empty"]')!;
      await waitFor(() => expect(empty).toHaveAttribute('data-app-design-owner'));
      for (const surface of [container, dialog]) {
        const guidance = surface.querySelector('[data-app-feedback-kind="empty"]')!;
        expect(consumes(guidance, feedbackRules,
          `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`, 'display')).toBe(true);
        expect(guidance.querySelector('[data-app-part~="feedback-title"]')).toHaveTextContent('No metric values are available yet.');
        expect(guidance.querySelector('[data-app-part~="feedback-message"]')).toHaveTextContent('Values will appear when the source provides measurements.');
        const chips = guidance.querySelectorAll('[data-app-part~="badge"]');
        expect([...chips].map(chip => chip.textContent)).toEqual(['Unreported reading', 'Invalid reading']);
        expect(consumes(chips[0], feedbackRules, '[data-app-part~="badge"]', 'white-space')).toBe(true);
        expect(guidance.querySelector('[data-app-part~="metric-value"]')).not.toBeInTheDocument();
      }
    } finally {
      release();
    }
  });
});
