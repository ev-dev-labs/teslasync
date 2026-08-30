import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ListSkeleton } from './ListSkeleton';

describe('ListSkeleton', () => {
  it('renders an accessible list-shaped loading region', () => {
    render(<ListSkeleton rows={3} label="Loading recent jobs…" />);

    expect(
      screen.getByRole('status', { name: 'Loading recent jobs…' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('list-skeleton').children).toHaveLength(3);
  });

  it('normalizes invalid row counts', () => {
    const { rerender } = render(<ListSkeleton rows={2.9} />);
    expect(screen.getByTestId('list-skeleton').children).toHaveLength(2);

    rerender(<ListSkeleton rows={Number.NaN} />);
    expect(screen.getByTestId('list-skeleton').children).toHaveLength(4);

    rerender(<ListSkeleton rows={-2} />);
    expect(screen.getByTestId('list-skeleton').children).toHaveLength(0);
  });
});
