import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

  it('uses outlined rectangular buttons and a solid theme-blue selected button', () => {
    render(
      <PillFilterBar
        items={items()}
        activeKey="anomalies"
        onChange={() => {}}
        ariaLabel="Drive collections"
      />,
    );
    const active = screen.getByRole('tab', { name: /anomalies/i });
    const inactive = screen.getByRole('tab', { name: /all/i });
    expect(active).toHaveClass('rounded-shape-sm', 'bg-[var(--theme-primary)]');
    expect(inactive).toHaveClass('rounded-shape-sm', 'border-[var(--control-border)]');
    expect(active).not.toHaveClass('rounded-full');
    expect(active.querySelector('.rounded-full')).toBeNull();
    expect(screen.getByRole('tab', { name: /tagged/i })).toBeDisabled();
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

  it('opts into a labelled group of native pressed filter buttons without tab semantics', () => {
    render(
      <PillFilterBar
        items={items()}
        activeKey="anomalies"
        onChange={() => {}}
        ariaLabel="Drive collections"
        semanticMode="filters"
      />,
    );
    const group = screen.getByRole('group', { name: /drive collections/i });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    expect(within(group).getByRole('button', { pressed: true })).toHaveTextContent(/anomalies/i);
    expect(within(group).getAllByRole('button', { pressed: false })).toHaveLength(4);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).not.toHaveAttribute('role', 'tab');
      expect(button).not.toHaveAttribute('aria-selected');
      expect(button).not.toHaveAttribute('aria-controls');
    }
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    expect(within(group).getByText(/\(4\)/)).toBeInTheDocument();
    expect(within(group).getByText(/\(1\)/)).toBeInTheDocument();
  });

  it('keeps every enabled filter in the native Tab order and disables unavailable filters', () => {
    const onChange = vi.fn();
    render(
      <PillFilterBar
        items={items()}
        activeKey="anomalies"
        onChange={onChange}
        ariaLabel="Drive collections"
        semanticMode="filters"
      />,
    );
    const enabled = screen.getAllByRole('button').filter((button) => !button.hasAttribute('disabled'));
    expect(enabled).toHaveLength(4);
    for (const button of enabled) {
      expect(button).toHaveAttribute('tabIndex', '0');
      expect(button).toBeEnabled();
    }
    const disabled = screen.getByRole('button', { name: /tagged/i });
    expect(disabled).toBeDisabled();
    fireEvent.click(disabled);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not intercept native Tab, Enter or Space or auto-activate filters on navigation keys', () => {
    const onChange = vi.fn();
    render(
      <PillFilterBar
        items={items()}
        activeKey="anomalies"
        onChange={onChange}
        ariaLabel="Drive collections"
        semanticMode="filters"
      />,
    );
    const active = screen.getByRole('button', { pressed: true });
    active.focus();
    for (const key of ['Tab', 'Enter', ' ', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(fireEvent.keyDown(active, { key })).toBe(true);
      expect(fireEvent.keyUp(active, { key })).toBe(true);
      expect(active).toHaveFocus();
    }
    expect(onChange).not.toHaveBeenCalled();
    // Native keyboard activation delivers a click; jsdom does not synthesize it from key events.
    fireEvent.click(active, { detail: 0 });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('anomalies');
  });

  it('keeps filter selection controlled and updates pressed state only from activeKey', () => {
    const onChange = vi.fn();
    const props = {
      items: items(),
      activeKey: 'all',
      onChange,
      ariaLabel: 'Drive collections',
      semanticMode: 'filters' as const,
    };
    const { rerender } = render(<PillFilterBar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /notable/i }));
    expect(onChange).toHaveBeenCalledWith('notable');
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent(/all/i);
    rerender(<PillFilterBar {...props} activeKey="notable" />);
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent(/notable/i);
    expect(screen.getByRole('button', { name: /all/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it.each(['pills', 'tabs'] as const)('keeps %s visual chrome independent of filter semantics', (variant) => {
    render(
      <PillFilterBar
        items={items()}
        activeKey="anomalies"
        onChange={() => {}}
        ariaLabel="Drive collections"
        semanticMode="filters"
        variant={variant}
      />,
    );
    const group = screen.getByRole('group');
    const selected = screen.getByRole('button', { pressed: true });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    if (variant === 'pills') {
      expect(selected).toHaveClass('rounded-shape-sm', 'bg-[var(--theme-primary)]');
      expect(screen.getByRole('button', { name: /all/i })).toHaveClass('border-[var(--control-border)]');
    } else {
      expect(group).toHaveClass('border-b');
      expect(selected).toHaveClass('border-amber-400', 'text-amber-300');
    }
  });

  it.each(['pills', 'tabs'] as const)('retains default tab semantics and activation with %s visual chrome', (variant) => {
    const onChange = vi.fn();
    render(
      <PillFilterBar
        items={items()}
        activeKey="anomalies"
        onChange={onChange}
        ariaLabel="Drive collections"
        variant={variant}
      />,
    );
    expect(screen.getByRole('tablist', { name: /drive collections/i })).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    const active = screen.getByRole('tab', { selected: true });
    expect(active).toHaveAttribute('tabIndex', '0');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).not.toHaveAttribute('aria-pressed');
      if (tab !== active) expect(tab).toHaveAttribute('tabIndex', '-1');
    }
    fireEvent.keyDown(active, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('notable');
    fireEvent.keyDown(active, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('all');
    fireEvent.keyDown(active, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('commutes');
  });
});
