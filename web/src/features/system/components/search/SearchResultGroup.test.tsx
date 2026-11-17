import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { SearchResultGroup } from './SearchResultGroup';
import type { SearchHitGroup } from './searchHelpers';

const controls = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'controls.css'), 'utf8'));
const group: SearchHitGroup = { type: 'drive', hits: [{
  type: 'drive', id: 91, title: 'Source drive with a complete long description',
  subtitle: 'Original source detail', when: '2026-10-01T12:00:00Z', url: '/drives/91', score: 1,
}] };

function Destination() {
  return <output aria-label="Destination">{useLocation().pathname}</output>;
}

describe('SearchResultGroup native navigation controls', () => {
  it.each(PACK_IDS)('%s owns the actual result link without replacing router navigation or its source content', pack => {
    const original = structuredClone(group);
    const view = render(<MemoryRouter initialEntries={['/search']}>
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <SearchResultGroup group={group} />
      </div>
      <Destination />
    </MemoryRouter>);
    const release = observeAppDesignScopes(view.container);
    try {
      const link = screen.getByRole('link', { name: `Open ${group.hits[0].title}` });
      const selected: string[] = [];
      controls.walkRules(rule => {
        selected.push(...rule.selectors.filter(selector =>
          selector.includes('[data-app-part~="button"]') && link.matches(selector)));
      });
      expect(selected.length).toBeGreaterThan(0);
      expect(link).toHaveAttribute('data-app-variant', 'ghost');
      expect(link).toHaveAttribute('href', '/drives/91');
      expect(link).toHaveClass('min-h-11', 'flex-wrap', 'whitespace-normal');
      expect(link).toHaveTextContent(group.hits[0].title);
      expect(link).toHaveTextContent('Original source detail');
      expect(link.querySelector('[role="tooltip"]')).not.toBeNull();
      fireEvent.click(link);
      expect(screen.getByLabelText('Destination')).toHaveTextContent('/drives/91');
      expect(group).toEqual(original);
    } finally {
      release();
      view.unmount();
    }
  });
});
