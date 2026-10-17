import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  it('has an accessible name and activates its action', () => {
    const onClick = vi.fn();
    render(<IconButton icon={<span aria-hidden="true">↻</span>} label="Refresh data" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Refresh data' });
    expect(button).toHaveAttribute('aria-describedby');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders a disabled link action without allowing navigation', () => {
    render(<MemoryRouter><IconButton icon={<span aria-hidden="true">◷</span>} label="View history" href="/history" disabled /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'View history' });
    expect(link).toHaveAttribute('href', '/history');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveAttribute('tabindex', '-1');
    fireEvent.click(link);
  });

  it('marks a busy button and preserves menu trigger attributes', () => {
    render(<IconButton icon={<span aria-hidden="true">•••</span>} label="More actions" busy aria-haspopup="menu" aria-expanded />);
    const button = screen.getByRole('button', { name: 'More actions' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
