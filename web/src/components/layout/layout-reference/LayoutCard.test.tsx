import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { Card } from '@/components/ui/Card';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { LayoutCard } from './LayoutCard';

const surfaceRules: Rule[] = [];
for (const segments of [['base.css'], ['packs', 'blueprint.css']]) {
  postcss.parse(readFileSync(
    resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', ...segments), 'utf8',
  )).walkRules(rule => {
    if (rule.selector.includes('[data-app-part~="card"]')
      && rule.selector.includes(':not([data-surface-variant="embedded"])')) surfaceRules.push(rule);
  });
}

describe('LayoutCard compatible surface ownership (source-only)', () => {
  it.each([false, true])('keeps canonical Card surface and existing section anatomy with delegated header=%s', delegated => {
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes('blueprint')}>
        <LayoutCard title="Source analysis" header={delegated ? <header>Source-owned header</header> : undefined}
          summary="Original summary" footer="Original footer">
          <p>Source-owned analysis</p>
        </LayoutCard>
        <Card data-app-part="section">Unrelated public override</Card>
        <Card variant="embedded">Embedded default</Card>
      </div>,
    );
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const card = container.querySelector('[data-card]')!;
      expect(card).toHaveAttribute('data-card-header-owner', delegated ? 'content' : 'host');
      expect(card).toHaveAttribute('data-card-size', 'full');
      expect(card).toHaveClass('flex', 'h-full', 'min-w-0', 'flex-col', 'gap-3', 'p-3', '@container');
      expect(card.matches('[data-app-part~="card"][data-app-part~="section"]')).toBe(true);
      expect(surfaceRules.filter(rule => card.matches(rule.selector)).length).toBeGreaterThanOrEqual(2);
      expect(card.querySelector('[data-card-content]')).toHaveAttribute('data-card-slot', delegated ? 'delegate' : 'body');
      expect(card.querySelector('[data-card-footer]')).toHaveTextContent('Original footer');
      expect(screen.getByText('Source-owned analysis')).toBeInTheDocument();
      const unrelated = screen.getByText('Unrelated public override');
      expect(unrelated).toHaveAttribute('data-app-part', 'section');
      expect(surfaceRules.some(rule => unrelated.matches(rule.selector))).toBe(false);
      const embedded = screen.getByText('Embedded default');
      expect(embedded).toHaveAttribute('data-surface-variant', 'embedded');
      expect(embedded).toHaveClass('bg-transparent', 'border-0', 'shadow-none');
      expect(surfaceRules.some(rule => embedded.matches(rule.selector))).toBe(false);
    } finally {
      release();
    }
  });

  it('retains the neutral surface and header API without assigning a design to an incomplete preview', () => {
    const { container } = render(
      <div data-app-design-preview="" data-app-design-pack="blueprint">
        <LayoutCard title="Neutral analysis" description="Original explanation">
          <p>Original evidence</p>
        </LayoutCard>
      </div>,
    );
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const card = container.querySelector('[data-card]')!;
      expect(card).not.toHaveAttribute('data-app-design-owner');
      expect(surfaceRules.some(rule => card.matches(rule.selector))).toBe(false);
      expect(card).toHaveClass('rounded-panel', 'border', 'bg-[var(--panel-bg)]', 'shadow-panel');
      expect(card.getAttribute('aria-labelledby')).toBe(screen.getByRole('heading', { name: 'Neutral analysis' }).id);
      expect(screen.getByText('Original evidence')).toBeInTheDocument();
    } finally {
      release();
    }
  });
});
