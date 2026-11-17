import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import postcss from 'postcss';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisitedPlaceCandidate } from '@/api/types';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { VisitedCandidates } from './VisitedCandidates';

const source = vi.hoisted(() => ({
  data: undefined as VisitedPlaceCandidate[] | undefined,
  isLoading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock('@/api/hooks/useLocations', () => ({ useVisitedPlaceCandidates: () => source }));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''),
      ),
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

function candidate(overrides: Partial<VisitedPlaceCandidate> = {}): VisitedPlaceCandidate {
  return {
    id: 8, name: 'Observed charging-place address '.repeat(6), latitude: 0, longitude: -122.3,
    visit_count: 3, charge_count: 1, last_visited: '2026-10-12T10:00:00Z', first_charge_at: null,
    ...overrides,
  };
}
function mount(children = <VisitedCandidates onReview={vi.fn()} />) {
  return render(<MemoryRouter>{children}</MemoryRouter>);
}
beforeEach(() => {
  cleanup();
  source.data = undefined;
  source.isLoading = false;
  source.error = null;
  source.refetch.mockClear();
});

describe('VisitedCandidates — actual owned candidate records (source-only)', () => {
  it.each(PACK_IDS)('%s paints independent retained candidates without changing evidence, coordinates or actions', pack => {
    const first = candidate();
    const unnamed = candidate({ id: 3, name: '', charge_count: 0 });
    source.data = [first, unnamed];
    source.error = new Error('refresh');
    const before = JSON.stringify(source.data);
    const review = vi.fn();
    const template = vi.fn();
    const view = mount(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <VisitedCandidates onReview={review} onSelectForTemplate={template} />
    </div>);
    const release = observeAppDesignScopes(view.container);
    try {
      const records = view.container.querySelectorAll<HTMLElement>('[data-app-part="card"][data-surface-variant="standalone"]');
      expect(records).toHaveLength(2);
      const sheet = postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'));
      for (const record of records) {
        expect(record).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
        let surfaceBound = false;
        sheet.walkRules(rule => {
          if (rule.selector.includes('[data-app-part~="card"]') && record.matches(rule.selector)) {
            rule.walkDecls('border-radius', () => { surfaceBound = true; });
          }
        });
        expect(surfaceBound).toBe(true);
        expect(record).toHaveClass('flex', 'flex-wrap', 'gap-3', 'p-3');
        expect(record.querySelector('[data-app-part~="metric"], [role="progressbar"]')).toBeNull();
      }
      expect(records[0]).toHaveTextContent(first.name.trim());
      expect(records[0]).toHaveTextContent('3 visits · 1 confirmed charges');
      expect(records[0]).toHaveTextContent('Likely charging');
      expect(records[1]).toHaveTextContent('0.0000, -122.3000');
      expect(records[1]).toHaveTextContent('Visited; charging not observed');
      expect(within(records[1]).getByRole('button', { name: 'Use in template' })).toBeDisabled();
      fireEvent.click(within(records[0]).getByRole('button', { name: 'Use in template' }));
      fireEvent.click(within(records[1]).getByRole('button', { name: 'Review place' }));
      expect(template).toHaveBeenCalledExactlyOnceWith(first.id);
      expect(review).toHaveBeenCalledExactlyOnceWith(unnamed);
      expect(JSON.stringify(source.data)).toBe(before);
      expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeInTheDocument();
    } finally { release(); }
  });

  it('distinguishes unresolved, loading, failed and successful-empty sources without inventing candidates', () => {
    const view = mount();
    expect(screen.getByText('Visited place suggestions are unavailable.')).toBeInTheDocument();
    source.isLoading = true;
    view.rerender(<MemoryRouter><VisitedCandidates onReview={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByText('No unmatched visited places in recent drive history.')).not.toBeInTheDocument();
    expect(view.container.querySelector('[data-app-part~="skeleton"]')).not.toBeNull();
    source.isLoading = false;
    source.error = new Error('failed');
    view.rerender(<MemoryRouter><VisitedCandidates onReview={vi.fn()} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(source.refetch).toHaveBeenCalledTimes(1);
    source.error = null;
    source.data = [];
    view.rerender(<MemoryRouter><VisitedCandidates onReview={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('No unmatched visited places in recent drive history.')).toBeInTheDocument();
    expect(view.container.querySelector('[data-app-part="card"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review place' })).not.toBeInTheDocument();
  });

  it('keeps the original records neutral without complete app ownership and omits optional template actions', () => {
    source.data = [candidate()];
    const view = mount(<div data-app-design-preview="" data-app-design-pack="v1">
      <VisitedCandidates onReview={vi.fn()} />
    </div>);
    const release = observeAppDesignScopes(view.container);
    try {
      const record = view.container.querySelector('[data-app-part="card"]')!;
      expect(record).not.toHaveAttribute('data-app-design-owner');
      expect(record).toHaveClass('rounded-lg', 'border', 'bg-[var(--surface-2)]', 'p-3');
      expect(screen.queryByRole('button', { name: 'Use in template' })).not.toBeInTheDocument();
    } finally { release(); }
  });
});
