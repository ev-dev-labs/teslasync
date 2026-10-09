/**
 * DriveDetailSkeleton — loading-state placeholder for DriveDetailPage.
 *
 * These tests lock the skeleton's *structure* (it must claim the same
 * vertical space as the real page so CLS stays ~0) and its *accessibility*
 * contract (a single, translated `role="status"` region announced to
 * assistive tech). Structure regressions here would reintroduce the layout
 * shift the skeleton exists to prevent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// Deterministic i18n: `t(key, fallback)` returns the English fallback so the
// accessible name is stable, and the spy lets us assert the exact key used.
const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: tSpy,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { DriveDetailSkeleton } from './DriveDetailSkeleton';

beforeEach(() => {
  tSpy.mockClear();
});

describe('DriveDetailSkeleton', () => {
  it('exposes the whole placeholder as a single labelled busy status region', () => {
    render(<DriveDetailSkeleton />);

    const region = screen.getByRole('status', { name: 'Loading drive detail' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveAttribute('data-testid', 'drive-detail-skeleton');
    // The overarching label must be distinct from the generic per-block
    // labels so screen readers announce the page, not just "Loading chart".
    expect(region).toHaveAccessibleName('Loading drive detail');
  });

  it('resolves the label through the driveDetail.loading i18n key with an English fallback', () => {
    render(<DriveDetailSkeleton />);

    expect(tSpy).toHaveBeenCalledWith('driveDetail.loading', 'Loading drive detail');
  });

  it('mirrors the DriveDetailPage layout: header, hero, 8 stat cards, 3 chart blocks', () => {
    const { container } = render(<DriveDetailSkeleton />);

    // Page header + hero-gauge placeholders.
    const header = screen.getByTestId('page-header-skeleton');
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute('aria-busy', 'true');
    expect(header.children[0]).toHaveClass('h-8', 'w-64', 'bg-[var(--skeleton-bg)]');
    expect(header.children[1]).toHaveClass('h-4', 'w-96', 'max-w-full', 'bg-[var(--skeleton-bg)]');
    for (const line of header.children) expect(line).toHaveAttribute('aria-hidden', 'true');
    const hero = container.querySelector('.h-36');
    expect(hero).toBeInTheDocument();
    expect(hero).toHaveClass('h-36', 'rounded-xl', 'bg-[var(--skeleton-bg)]');
    expect(hero).toHaveAttribute('aria-hidden', 'true');

    // KPI band — DriveStatCards renders 8 metrics, so the grid must reserve 8.
    const statGrid = screen.getByTestId('stat-grid-skeleton');
    expect(statGrid.childElementCount).toBe(8);
    expect(statGrid).toHaveAttribute('aria-busy', 'true');
    expect(statGrid).toHaveClass('sm:grid-cols-4', 'lg:grid-cols-8');
    for (const card of statGrid.children) {
      expect(card).toHaveClass('h-24', 'rounded-xl', 'bg-[var(--skeleton-bg)]');
      expect(card).toHaveAttribute('aria-hidden', 'true');
    }

    // Overview chart + the two side-by-side detail charts (SoC + elevation).
    expect(screen.getAllByTestId('chart-block-skeleton')).toHaveLength(3);
    for (const chart of screen.getAllByTestId('chart-block-skeleton')) {
      expect(chart).toHaveAttribute('aria-busy', 'true');
      expect(chart.firstElementChild).toHaveClass('rounded-xl', 'bg-[var(--skeleton-bg)]');
      expect(chart.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('sizes the overview chart at 320px and lays the two detail charts side-by-side at 280px', () => {
    const { container } = render(<DriveDetailSkeleton />);

    const charts = screen.getAllByTestId('chart-block-skeleton');
    expect((charts[0].firstElementChild as HTMLElement).style.height).toBe('320px');
    expect((charts[1].firstElementChild as HTMLElement).style.height).toBe('280px');
    expect((charts[2].firstElementChild as HTMLElement).style.height).toBe('280px');

    // The last two charts live in a 2-column grid (desktop side-by-side).
    const twoColGrid = container.querySelector('.lg\\:grid-cols-2');
    expect(twoColGrid).not.toBeNull();
    expect(within(twoColGrid as HTMLElement).getAllByTestId('chart-block-skeleton')).toHaveLength(2);
  });
});
