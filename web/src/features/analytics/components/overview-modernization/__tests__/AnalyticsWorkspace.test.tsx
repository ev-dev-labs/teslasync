import type { ReactNode } from 'react';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsWorkspace } from '../AnalyticsWorkspace';
import type { TabKey } from '../../analytics/constants';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'driving', label: 'Driving' },
  { key: 'charging', label: 'Charging' },
  { key: 'battery', label: 'Battery' },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderWorkspace() {
  return render(
    <AnalyticsWorkspace tabs={tabs} activeTab="overview" onTabChange={vi.fn()}
      summary={<div data-testid="specialist-summary">Unchanged metric renderer</div>}>
      <div data-testid="specialist-domain">
        <a href="/statistics">Existing specialist action</a>
        <span>Existing source detail</span>
      </div>
    </AnalyticsWorkspace>,
  );
}

describe('analytics shared layout composition', () => {
  it.each([320, 375, 390, 430, 768, 1024, 1280, 1440, 1920, 2560])(
    'allocates full-width source groups through exactly one observer at host width %i',
    width => {
      const observe = vi.fn();
      const disconnect = vi.fn();
      const created = vi.fn();
      vi.stubGlobal('ResizeObserver', class {
        constructor() { created(); }
        observe = observe;
        disconnect = disconnect;
      });
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
      const { container, unmount } = renderWorkspace();
      const grids = container.querySelectorAll('[data-card-grid]');
      expect(grids).toHaveLength(1);
      expect(created).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledTimes(1);
      const grid = grids[0].firstElementChild;
      expect(grid?.children).toHaveLength(3);
      const span = width < 640 ? 1 : width < 1024 ? 6 : 12;
      Array.from(grid?.children ?? []).forEach(item => {
        expect(item).toHaveAttribute('data-card-size', 'full');
        expect(item).toHaveAttribute('data-card-resolved-span', String(span));
        expect(item).toHaveClass(`col-span-${span}`);
        expect(item.className).not.toMatch(/\bmax-w-|\bmx-auto\b/);
      });
      expect(grid?.children[0]).toContainElement(screen.getByTestId('specialist-summary'));
      expect(grid?.children[1]).toContainElement(screen.getByRole('navigation', { name: 'Analytics sections' }));
      expect(grid?.children[2]).toContainElement(screen.getByTestId('specialist-domain'));
      expect(screen.getByText('Existing source detail')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Existing specialist action' })).toHaveAttribute('href', '/statistics');
      unmount();
      expect(disconnect).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves all four navigation keys, pressed states and the active specialist renderer', () => {
    function Harness() {
      const [active, setActive] = useState<TabKey>('overview');
      return (
        <AnalyticsWorkspace tabs={tabs} activeTab={active} onTabChange={setActive}
          summary={<div data-testid="summary">Retained summary</div>}>
          <div key={active} data-testid={`domain-${active}`}>{active}</div>
        </AnalyticsWorkspace>
      );
    }
    render(<Harness />);
    const nav = screen.getByRole('navigation', { name: 'Analytics sections' });
    expect(within(nav).getAllByRole('button')).toHaveLength(4);
    expect(within(nav).getByRole('group', { name: 'Analytics sections' }))
      .toHaveClass('[&_button]:min-h-11', '[&_button]:min-w-11');
    expect(screen.getByRole('region', { name: 'Fleet summary metrics' }))
      .toContainElement(screen.getByTestId('summary'));
    let previous = 'overview';
    tabs.forEach(tab => {
      fireEvent.click(within(nav).getByRole('button', { name: tab.label }));
      expect(within(nav).getByRole('button', { name: tab.label })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByTestId(`domain-${tab.key}`)).toBeInTheDocument();
      if (previous !== tab.key) expect(screen.queryByTestId(`domain-${previous}`)).not.toBeInTheDocument();
      expect(screen.getByTestId('summary')).toBeInTheDocument();
      previous = tab.key;
    });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/vehicle|date range/i)).not.toBeInTheDocument();
  });

  it('does not gate independent specialist content on the summary state', () => {
    const { rerender } = renderWorkspace();
    ['Initial loading', 'No fleet data', 'Fleet source unavailable'].forEach(state => {
      rerender(
        <AnalyticsWorkspace tabs={tabs} activeTab="overview" onTabChange={vi.fn()}
          summary={<div role="status">{state}</div>}>
          <a href="/timeline">Independent existing link</a>
        </AnalyticsWorkspace>,
      );
      expect(screen.getByRole('region', { name: 'Fleet summary metrics' })).toBeInTheDocument();
      expect(screen.getByRole('navigation', { name: 'Analytics sections' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Independent existing link' })).toHaveAttribute('href', '/timeline');
    });
  });
});
