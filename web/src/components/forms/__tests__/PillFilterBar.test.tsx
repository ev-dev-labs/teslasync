import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { PillFilterBar, type PillItem } from '../PillFilterBar';

function items(): PillItem[] {
  return [
    { key: 'all', label: 'All', count: 4 },
    { key: 'anomalies', label: 'Anomalies', count: 1, accent: 'amber' },
    { key: 'notable', label: 'Notable', count: 2, accent: 'purple' },
    { key: 'commutes', label: 'Commutes', count: 3 },
    { key: 'tagged', label: 'Tagged', disabled: true },
  ];
}

describe('PillFilterBar', () => {
  it('renders one pill per item with role="tab"', () => {
    render(
      <PillFilterBar
        items={items()}
        activeKey="all"
        onChange={() => {}}
        ariaLabel="Drive collections"
      />,
    );
    const tablist = screen.getByRole('tablist', { name: /drive collections/i });
    expect(tablist).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });

  it('marks the active pill aria-selected and tabIndex 0; others are -1', () => {
    render(
      <PillFilterBar
        items={items()}
        activeKey="anomalies"
        onChange={() => {}}
        ariaLabel="Drive collections"
      />,
    );
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveAttribute('tabIndex', '0');
    expect(active).toHaveTextContent(/anomalies/i);
    for (const tab of screen.getAllByRole('tab', { selected: false })) {
      expect(tab).toHaveAttribute('tabIndex', '-1');
    }
  });

  it('shows count suffix when provided', () => {
    render(
      <PillFilterBar
        items={items()}
        activeKey="all"
        onChange={() => {}}
        ariaLabel="x"
      />,
    );
    expect(screen.getByText(/\(4\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(1\)/)).toBeInTheDocument();
  });

  it('fires onChange with the clicked key', () => {
    const onChange = vi.fn();
    render(
      <PillFilterBar
        items={items()}
        activeKey="all"
        onChange={onChange}
        ariaLabel="x"
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: /notable/i }));
    expect(onChange).toHaveBeenCalledWith('notable');
  });

  it('moves activation with ArrowRight / ArrowLeft skipping disabled', () => {
    const onChange = vi.fn();
    render(
      <PillFilterBar
        items={items()}
        activeKey="commutes"
        onChange={onChange}
        ariaLabel="x"
      />,
    );
    const active = screen.getByRole('tab', { selected: true });
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    // 'tagged' is disabled → wraps around to 'all'
    expect(onChange).toHaveBeenCalledWith('all');

    onChange.mockClear();
    fireEvent.keyDown(active, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('notable');
  });

  it('Home / End jump to first and last enabled', () => {
    const onChange = vi.fn();
    render(
      <PillFilterBar
        items={items()}
        activeKey="anomalies"
        onChange={onChange}
        ariaLabel="x"
      />,
    );
    const active = screen.getByRole('tab', { selected: true });
    fireEvent.keyDown(active, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('all');

    onChange.mockClear();
    fireEvent.keyDown(active, { key: 'End' });
    // 'tagged' is disabled → last enabled is 'commutes'
    expect(onChange).toHaveBeenCalledWith('commutes');
  });

  it('does not fire onChange when a disabled pill is clicked', () => {
    const onChange = vi.fn();
    render(
      <PillFilterBar
        items={items()}
        activeKey="all"
        onChange={onChange}
        ariaLabel="x"
      />,
    );
    const tagged = screen.getByRole('tab', { name: /tagged/i });
    expect(tagged).toBeDisabled();
    fireEvent.click(tagged);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders tabs variant with bottom border', () => {
    render(
      <PillFilterBar
        items={items()}
        activeKey="all"
        onChange={() => {}}
        ariaLabel="x"
        variant="tabs"
      />,
    );
    const list = screen.getByRole('tablist');
    expect(list.className).toMatch(/border-b/);
  });
});
