import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { KindFilterBar } from './KindFilterBar';
import type { ActivityKind } from '@/types/activity';

describe('KindFilterBar', () => {
  it('marks "All" pressed when no kinds are active', () => {
    render(<KindFilterBar activeKinds={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^all$/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks a kind chip pressed when it is in activeKinds', () => {
    render(<KindFilterBar activeKinds={['drive']} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^drive$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^all$/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a kind to the active set when an inactive chip is clicked', () => {
    const onChange = vi.fn();
    render(<KindFilterBar activeKinds={['drive']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /charging/i }));
    expect(onChange).toHaveBeenCalledWith(['drive', 'charging']);
  });

  it('removes a kind from the active set when an active chip is clicked again', () => {
    const onChange = vi.fn();
    render(<KindFilterBar activeKinds={['drive', 'charging']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^drive$/i }));
    expect(onChange).toHaveBeenCalledWith(['charging']);
  });

  it('clears the filter back to "all" when the All chip is clicked', () => {
    const onChange = vi.fn();
    render(<KindFilterBar activeKinds={['drive', 'alert']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders one chip per known activity kind plus the All chip', () => {
    const kinds: ActivityKind[] = ['drive', 'charging', 'alert', 'software_update', 'annotation'];
    render(<KindFilterBar activeKinds={[]} onChange={vi.fn()} />);
    // 5 kinds + All = 6 buttons in the group.
    expect(screen.getAllByRole('button')).toHaveLength(kinds.length + 1);
  });
});
