import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ChartBlockSkeleton,
  TableSkeleton,
} from '../PageSkeleton';

/**
 * Phase-45 / Prompt 18 — Page-skeleton building blocks.
 *
 * Each shaped-skeleton primitive must:
 *  - Render without crashing
 *  - Announce itself as `role="status"` with `aria-busy="true"` so screen
 *    readers identify the loading region.
 *  - Render the right number of child placeholders for the variant inputs
 *    (cards/rows/cols) so layouts mirror the real content.
 */

describe('PageHeaderSkeleton', () => {
  it('renders with role=status and aria-busy=true', () => {
    render(<PageHeaderSkeleton />);
    const region = screen.getByTestId('page-header-skeleton');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-busy', 'true');
  });
});

describe('StatGridSkeleton', () => {
  it('renders with role=status and aria-busy=true', () => {
    render(<StatGridSkeleton />);
    const region = screen.getByTestId('stat-grid-skeleton');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('defaults to 4 cards', () => {
    render(<StatGridSkeleton />);
    const region = screen.getByTestId('stat-grid-skeleton');
    expect(region.children).toHaveLength(4);
  });

  it('renders the requested number of cards', () => {
    render(<StatGridSkeleton cards={6} />);
    const region = screen.getByTestId('stat-grid-skeleton');
    expect(region.children).toHaveLength(6);
  });
});

describe('ChartBlockSkeleton', () => {
  it('renders with role=status and aria-busy=true', () => {
    render(<ChartBlockSkeleton />);
    const region = screen.getByTestId('chart-block-skeleton');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('respects the height prop', () => {
    render(<ChartBlockSkeleton height={400} />);
    const region = screen.getByTestId('chart-block-skeleton');
    const inner = region.querySelector('div');
    expect(inner).not.toBeNull();
    expect(inner).toHaveStyle({ height: '400px' });
  });
});

describe('TableSkeleton', () => {
  it('renders with role=status and aria-busy=true', () => {
    render(<TableSkeleton />);
    const region = screen.getByTestId('table-skeleton');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-busy', 'true');
  });

  it('defaults to 8 body rows', () => {
    render(<TableSkeleton />);
    const region = screen.getByTestId('table-skeleton');
    // 1 header bar + 8 body rows = 9 children
    expect(region.children).toHaveLength(9);
  });

  it('renders the requested rows × cols', () => {
    render(<TableSkeleton rows={3} cols={5} />);
    const region = screen.getByTestId('table-skeleton');
    expect(region.children).toHaveLength(4);
    const firstBodyRow = region.children[1] as HTMLElement;
    expect(firstBodyRow.children).toHaveLength(5);
  });
});
