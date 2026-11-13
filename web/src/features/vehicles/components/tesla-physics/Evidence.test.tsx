import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { RawRows } from './Evidence';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }),
}));

const rows = [{ id: 'zero', reading: 0, status: false, timestamp: null }];
const columns = [
  { key: 'id', header: 'Source identity', render: (row: typeof rows[number]) => row.id },
  { key: 'reading', header: 'Reading', render: (row: typeof rows[number]) => row.reading },
  { key: 'status', header: 'Flag', render: (row: typeof rows[number]) => String(row.status) },
  { key: 'timestamp', header: 'Timestamp', render: (row: typeof rows[number]) => row.timestamp },
];
const definitionSelectors: string[] = [];
postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => {
    definitionSelectors.push(...rule.selectors.filter(selector =>
      selector.includes('data-app-list="definitions"') && selector.includes('data-app-design-owner')));
  });

describe('RawRows native expanded evidence', () => {
  it.each(Object.keys(APPLICATION_DESIGNS) as Array<keyof typeof APPLICATION_DESIGNS>)(
    'opens genuine definitions under %s, retaining zero, false and missing values',
    async (pack) => {
      const view = render(<section data-app-design-preview {...getAppDesignAttributes(pack)}>
        <RawRows title="Synthetic evidence" rows={rows} columns={columns} tableId={`vehicles-01:raw:${pack}`}
          keyExtractor={row => row.id} t={(_key, fallback) => fallback} disclosureLabel="Inspect synthetic evidence" />
      </section>);
      const release = observeAppDesignScopes(view.container);
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Inspect synthetic evidence' }));
        fireEvent.click(screen.getByRole('button', { name: 'Expand row: zero' }));
        const definitions = view.container.querySelector('dl[data-app-list="definitions"]')!;
        await waitFor(() => {
          expect(definitions.firstElementChild?.getAttribute('data-app-design-owner'))
            .toContain(`data-${APPLICATION_DESIGNS[pack].data}`);
        });
        const selectors = definitionSelectors.filter(selector =>
          selector.includes(`[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`));
        expect([...definitions.children].map(field => field.querySelector('dt')?.textContent))
          .toEqual(columns.map(column => column.header));
        expect([...definitions.children].map(field => field.querySelector('dd')?.textContent))
          .toEqual(['zero', '0', 'false', '—']);
        for (const field of definitions.children) {
          expect(field).toHaveAttribute('data-app-part', 'list-row');
          expect(field.querySelector('dt')).toHaveAttribute('data-app-part', 'metric-label');
          expect(field.querySelector('dd')).toHaveAttribute('data-app-part', 'metric-value');
          expect(field.getAttribute('data-app-design-owner')).toContain(`data-${APPLICATION_DESIGNS[pack].data}`);
          expect(selectors.some(selector => field.matches(selector))).toBe(true);
        }
        expect(within(definitions as HTMLElement).getByText('0', { exact: true })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Collapse row: zero' }));
        expect(definitions).not.toBeInTheDocument();
      } finally { release(); }
    },
  );

  it('keeps the existing mobile-presentation path non-expandable and available through its own details engine', () => {
    const view = render(<RawRows title="Clock evidence" rows={rows} columns={columns} tableId="vehicles-01:clock"
      keyExtractor={row => row.id} t={(_key, fallback) => fallback} disclosureLabel="Inspect clock evidence"
      mobilePresentation={{ roles: { id: 'title', reading: 'primary' }, displayValue: (row, key) =>
        key === 'id' ? row.id : key === 'reading' ? row.reading : key === 'status' ? String(row.status) : row.timestamp }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect clock evidence' }));
    expect(screen.queryByRole('button', { name: /^Expand row/ })).toBeNull();
    expect(view.container.querySelector('dl[data-app-list="definitions"]')).toBeNull();
    expect(screen.getByRole('table')).toHaveTextContent('zero');
  });
});
