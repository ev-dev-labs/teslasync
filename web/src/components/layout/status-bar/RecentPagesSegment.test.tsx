import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRecentPagesForTests,
  recordPageView,
} from '@/lib/recentPages';
import { RecentPagesSegment } from './RecentPagesSegment';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | Record<string, unknown>) => {
      if (typeof fallbackOrOptions === 'string') return fallbackOrOptions;
      const fallback =
        typeof fallbackOrOptions?.defaultValue === 'string'
          ? fallbackOrOptions.defaultValue
          : _key;
      return Object.entries(fallbackOrOptions ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
        fallback,
      );
    },
  }),
}));

function renderSegment(iconOnly = false) {
  return render(
    <MemoryRouter>
      <RecentPagesSegment iconOnly={iconOnly} />
    </MemoryRouter>,
  );
}

describe('RecentPagesSegment', () => {
  beforeEach(() => {
    __resetRecentPagesForTests();
  });

  afterEach(() => {
    __resetRecentPagesForTests();
  });

  it('keeps an empty recent-pages affordance in the status bar', () => {
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 0 saved',
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Recently viewed' })).toBeInTheDocument();
    expect(screen.getByTestId('status-bar-recent-empty')).toHaveTextContent(
      'Pages you visit will appear here for quick access.',
    );
  });

  it('opens the most recently visited pages in newest-first order', () => {
    recordPageView({ path: '/vehicles/1', title: 'Model 3', kind: 'vehicle' });
    recordPageView({ path: '/drives/42', title: 'Drive 42', kind: 'drive' });
    recordPageView({ path: '/charging/7', title: 'Charge 7', kind: 'charging' });
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 3 saved',
    });
    expect(trigger).toHaveTextContent('Recent');
    expect(trigger).not.toHaveTextContent('3');
    fireEvent.click(trigger);

    const list = screen.getByTestId('status-bar-recent-list');
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Charge 7');
    expect(rows[1]).toHaveTextContent('Drive 42');
    expect(rows[2]).toHaveTextContent('Model 3');
    expect(rows[0]).toHaveAttribute('href', '/charging/7');
  });

  it('caps the popover at five entries while retaining the full saved count', () => {
    for (let index = 0; index < 12; index += 1) {
      recordPageView({
        path: `/vehicles/${index}`,
        title: `Vehicle ${index}`,
        kind: 'vehicle',
      });
    }
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 12 saved',
    });
    fireEvent.click(trigger);

    expect(within(screen.getByTestId('status-bar-recent-list')).getAllByRole('link')).toHaveLength(5);
    expect(screen.getByText('12 pages')).toBeInTheDocument();
  });

  it('updates live when navigation records another page', () => {
    renderSegment();
    expect(
      screen.getByRole('button', { name: 'Open recently viewed pages, 0 saved' }),
    ).toBeInTheDocument();

    act(() => {
      recordPageView({ path: '/trips/9', title: 'Weekend trip', kind: 'trip' });
    });

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 1 saved',
    });
    fireEvent.click(trigger);
    expect(screen.getByText('Weekend trip')).toBeInTheDocument();
  });

  it('closes after navigation and restores trigger focus on Escape', () => {
    recordPageView({ path: '/drives/55', title: 'Drive 55', kind: 'drive' });
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 1 saved',
    });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Recently viewed' })).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('status-bar-recent-row-/drives/55'));
    expect(screen.queryByRole('dialog', { name: 'Recently viewed' })).toBeNull();
  });

  it('closes on an outside pointer interaction', () => {
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 0 saved',
    });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Recently viewed' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('dialog', { name: 'Recently viewed' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('collapses to an icon-only trigger without losing its accessible name', () => {
    renderSegment(true);

    expect(screen.queryByText('Recent')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open recently viewed pages, 0 saved' }),
    ).toBeInTheDocument();
  });

  it('uses the generic page icon branch for uncategorized routes', () => {
    recordPageView({ path: '/system', title: 'System', kind: 'page' });
    renderSegment();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open recently viewed pages, 1 saved',
      }),
    );

    expect(screen.getByTestId('status-bar-recent-row-/system')).toHaveAttribute(
      'href',
      '/system',
    );
    expect(
      screen.getByTestId('status-bar-recent-row-/system').querySelector('[data-page-kind="page"]'),
    ).toBeInTheDocument();
  });
});
