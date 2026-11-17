import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { getAppDesignAttributes, observeAppDesignScopes } from '../ui/app-designs/designs';
import { EntityPreviewDrawer } from './EntityPreviewDrawer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const rules: Rule[] = [];
postcss.parse(readFileSync(
  resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'controls.css'), 'utf8',
)).walkRules(rule => { rules.push(rule); });

describe('EntityPreviewDrawer real outline navigation consumers (source-only)', () => {
  it.each(['classic', 'v2', 'v3', 'v6'] as const)('%s composes actual anchors without replacing navigation with buttons', async pack => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
          <EntityPreviewDrawer open onClose={onClose} eyebrow="Retained record" title="Selected source"
            fields={[{ key: 'zero', label: 'Measured zero', value: 0, detail: 'The original count was zero.' }]}
            relatedActions={[{ key: 'history', label: 'Read original history', to: '/signals?vehicle_id=42',
              onNavigate }]} />
        </div>
      </MemoryRouter>,
    );
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const link = screen.getByRole('link', { name: 'Read original history' });
      await waitFor(() => expect(link).toHaveAttribute('data-app-design-owner'));
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', '/signals?vehicle_id=42');
      expect(link).not.toHaveAttribute('role');
      expect(link).not.toHaveAttribute('type');
      const matching = rules.filter(rule => link.matches(rule.selector));
      expect(matching.some(rule => rule.selector.includes('[data-app-part~="button"]')
        && rule.nodes.some(node => node.type === 'decl' && node.prop === 'touch-action'))).toBe(true);
      const mode = getAppDesignAttributes(pack)['data-app-controls'];
      expect(matching.some(rule => rule.selector.includes(`[data-app-controls="${mode}"]`)
        && rule.selector.includes('[data-app-variant="outline"]')
        && rule.nodes.some(node => node.type === 'decl' && node.prop.startsWith('border')))).toBe(true);
      expect(link).toHaveClass('min-h-11', 'whitespace-normal', 'text-start');
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('The original count was zero.')).toBeInTheDocument();
      fireEvent.click(link);
      expect(onNavigate).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
      expect(onNavigate.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    } finally {
      release();
    }
  });

  it('keeps neutral/public anchors usable without a verified design profile', () => {
    render(
      <MemoryRouter>
        <EntityPreviewDrawer open onClose={vi.fn()} eyebrow="Public record" title="Neutral preview" fields={[]}
          relatedActions={[{ key: 'history', label: 'Read original history', to: '/signals' }]} />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Read original history' });
    expect(link).not.toHaveAttribute('data-app-design-owner');
    expect(rules.some(rule => link.matches(rule.selector))).toBe(false);
    expect(link).toHaveAttribute('href', '/signals');
    expect(link).toHaveClass('bg-transparent', 'border', 'min-h-11');
    expect(screen.queryByRole('button', { name: 'Read original history' })).not.toBeInTheDocument();
  });
});
