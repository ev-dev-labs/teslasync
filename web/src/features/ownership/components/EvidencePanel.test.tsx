import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, type Rule } from 'postcss';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';
import { EvidencePanel } from './EvidencePanel';

const rules: Rule[] = [];
for (const sheet of ['base', 'feedback']) {
  parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', `${sheet}.css`), 'utf8'))
    .walkRules(rule => { rules.push(rule); });
}

function consumes(node: Element | null, contract: string, property: string) {
  return node != null && rules.some(rule => rule.selector.includes(contract)
    && rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === property)
    && Array.from(node.ownerDocument.querySelectorAll(rule.selector)).includes(node));
}

const evidence = [
  { source: 'Recorded inspections', summary: 'No matching observations', sample_count: 0, observed_at: null },
  { source: 'Imported service record', summary: 'Source currency and service date retained', sample_count: null, observed_at: '2026-03-01T00:00:00Z' },
];

describe('EvidencePanel native source and warning ownership', () => {
  it.each(['classic', 'v2', 'v1'] as const)('%s composes actual records and the full unsupported notice without new announcements', pack => {
    const { container, rerender } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <EvidencePanel evidence={evidence} limitations={['Projection, not physical inspection']}
          unsupported={['Physical wear is not measured', 'No recall service']} />
      </div>,
    );
    const host = container.firstElementChild!;
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    const record = within(sources).getByText('Recorded inspections').closest('[data-app-part~="card"]');
    expect(record).not.toHaveAttribute('data-app-design-owner');
    const release = observeAppDesignScopes(host);
    try {
      expect(consumes(record, '[data-app-part~="card"]', 'border-radius')).toBe(true);
      expect(record).toHaveTextContent('0 samples');
      expect(sources.querySelectorAll('[data-app-part~="card"]')).toHaveLength(2);
      expect(sources).toHaveTextContent('Source currency and service date retained');
      expect(screen.getByText('Quality metadata has not been computed yet.')).toBeInTheDocument();
      const notice = screen.getByText('Explicitly not computed').closest('[data-app-feedback-kind="notice"]');
      expect(notice).toHaveAttribute('data-app-tone', 'warning');
      expect(consumes(notice, `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`, 'border')).toBe(true);
      expect(consumes(notice?.querySelector('[data-app-part~="feedback-content"]') ?? null,
        '[data-app-feedback-kind="notice"]', 'grid-column')).toBe(true);
      expect(notice?.querySelectorAll('[data-app-part~="feedback-message"]')).toHaveLength(2);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('• Projection, not physical inspection')).toBeInTheDocument();
    } finally {
      release();
    }
    rerender(<EvidencePanel evidence={[]} quality={null} unsupported={[]} />);
    expect(screen.getByText('No supporting evidence was returned.')).toBeInTheDocument();
    expect(screen.queryByText('Explicitly not computed')).not.toBeInTheDocument();
    expect(container.querySelector('[data-app-design-owner]')).not.toBeInTheDocument();
  });

  it('retains the actual evidence through refresh failure and pause, but isolates fatal recovery without fabricating records', () => {
    const refetch = vi.fn();
    const tree = (source: Parameters<typeof EvidencePanel>[0]['source']) => (
      <MemoryRouter><EvidencePanel evidence={evidence} source={source} unsupported={['Not measured']} /></MemoryRouter>
    );
    const { rerender } = render(tree({ data: evidence, error: new Error('refresh failed'), refetch }));
    expect(screen.getByText('Recorded inspections')).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    rerender(tree({ data: evidence, fetchStatus: 'paused', refetch }));
    expect(screen.getByText('Recorded inspections')).toBeInTheDocument();
    expect(screen.getByText(/Cached evidence remains visible while its refresh is paused/)).toBeInTheDocument();
    expect(screen.queryByText(/Previously loaded data remains visible/)).not.toBeInTheDocument();
    rerender(tree({ error: new Error('initial failed'), refetch }));
    expect(screen.queryByText('Recorded inspections')).not.toBeInTheDocument();
    expect(screen.queryByText('Explicitly not computed')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(2);
    rerender(tree({ data: evidence }));
    expect(screen.getByText('Recorded inspections')).toBeInTheDocument();
    expect(screen.getByText('Explicitly not computed')).toBeInTheDocument();
  });

  it('preserves quality reasons and distinguishes unresolved or disabled sources from an empty returned evidence array', () => {
    const quality = { status: 'limited' as const, sample_count: 0, coverage_pct: null,
      window_start: null, window_end: null, reasons: ['No supported history'] };
    const { rerender } = render(<EvidencePanel source={{ isPending: true }} evidence={[]} />);
    expect(screen.getByRole('status', { name: 'Loading Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    rerender(<EvidencePanel source={{ fetchStatus: 'paused' }} evidence={[]} />);
    expect(screen.getByText(/initial query is paused/)).toBeInTheDocument();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    rerender(<EvidencePanel source={{ isPending: true }} sourceEnabled={false} evidence={[]} quality={quality} />);
    expect(screen.getByText('No supporting evidence was returned.')).toBeInTheDocument();
    expect(screen.getByText('• No supported history')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('row', { name: 'Samples 0' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Coverage —' })).toBeInTheDocument();
    expect(screen.queryByText('Explicitly not computed')).not.toBeInTheDocument();
  });
});
