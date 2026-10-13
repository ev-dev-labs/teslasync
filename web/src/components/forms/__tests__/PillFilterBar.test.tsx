import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
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

  it('generates 44px touch minima below md and restores original md density', async () => {
    const onChange = vi.fn();
    const props = { items: items(), activeKey: 'anomalies', onChange, ariaLabel: 'Drive collections' };
    const { rerender } = render(<PillFilterBar {...props} />);
    const profiles: { className: string; scrollable: boolean }[] = [];
    for (const variant of ['pills', 'tabs'] as const) {
      for (const semanticMode of ['tabs', 'filters'] as const) {
        for (const scrollable of [true, false]) {
          rerender(<PillFilterBar {...props} variant={variant} semanticMode={semanticMode} scrollable={scrollable} />);
          const role = semanticMode === 'tabs' ? 'tab' : 'button';
          const buttons = screen.getAllByRole(role);
          expect(buttons.map(button => button.textContent)).toEqual([
            'All(4)', 'Anomalies(1)', 'Notable(2)', 'Commutes(3)', 'Tagged',
          ]);
          const selected = screen.getByRole(role, { name: /anomalies/i });
          expect(selected).toHaveAttribute(semanticMode === 'tabs' ? 'aria-selected' : 'aria-pressed', 'true');
          expect(selected).toHaveAttribute('tabIndex', '0');
          expect(screen.getByRole(role, { name: /all/i })).toHaveAttribute('tabIndex', semanticMode === 'tabs' ? '-1' : '0');
          const disabled = screen.getByRole(role, { name: 'Tagged' });
          expect(disabled).toBeDisabled();
          onChange.mockClear();
          fireEvent.click(disabled);
          expect(onChange).not.toHaveBeenCalled();
          fireEvent.click(screen.getByRole(role, { name: /notable/i }));
          expect(onChange).toHaveBeenCalledExactlyOnceWith('notable');
          for (const button of buttons) {
            expect(button).toHaveClass('min-h-11', 'min-w-11', 'md:min-w-0');
            expect(button).not.toHaveClass('h-9');
            profiles.push({ className: button.className, scrollable });
          }
        }
      }
    }
    const config = loadConfig(resolve('tailwind.config.js'));
    const root = (await postcss([tailwindcss({
      ...config,
      content: [{ raw: profiles.map(profile => profile.className).join(' '), extension: 'html' }],
    })]).process('@tailwind utilities;', { from: undefined })).root;
    const dimensions = (className: string, width: number) => {
      const classes = className.split(/\s+/);
      const result: Record<string, string> = {};
      root.walkRules(rule => {
        if (!classes.includes(rule.selector.replace(/\\(.)/g, '$1').slice(1))) return;
        const parent = rule.parent;
        if (parent instanceof postcss.AtRule && parent.name === 'media') {
          // Button also retains reduced-motion/forced-colors media rules;
          // they do not determine viewport sizing.
          if (!parent.params.startsWith('(min-width:')) return;
          expect(parent.params).toBe('(min-width: 768px)');
          if (width < 768) return;
        }
        rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
      });
      return result;
    };
    for (const profile of profiles) {
      for (const width of [375, 767]) {
        expect(dimensions(profile.className, width)).toMatchObject({
          height: profile.scrollable ? '2.75rem' : 'auto',
          'min-height': '2.75rem',
          'min-width': '2.75rem',
        });
      }
      expect(dimensions(profile.className, 768)).toMatchObject({
        height: profile.scrollable ? '2.25rem' : 'auto',
        'min-height': profile.scrollable ? '0px' : '2.25rem',
        'min-width': '0px',
      });
    }
    console.log('SOURCE CSS: real merged Buttons have 2.75rem (44px at 16px root) minima at 375/767px; original 36px or multiline md density at 768px; native geometry NOTRUN.');
  });

  it('moves real roving focus and controlled selection with Left Right Home and End', () => {
    const onChange = vi.fn();
    const frames: FrameRequestCallback[] = [];
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback);
      return frames.length;
    });
    function ControlledTabs() {
      const [activeKey, setActiveKey] = useState('commutes');
      return <PillFilterBar
        items={items()}
        activeKey={activeKey}
        onChange={key => { onChange(key); setActiveKey(key); }}
        ariaLabel="Drive collections"
      />;
    }
    try {
      render(<ControlledTabs />);
      const initial = screen.getByRole('tab', { name: /commutes/i });
      initial.focus();
      expect(initial).toHaveFocus();
      for (const [key, expectedKey, name] of [
        ['ArrowRight', 'all', /all/i],
        ['ArrowLeft', 'commutes', /commutes/i],
        ['ArrowLeft', 'notable', /notable/i],
        ['Home', 'all', /all/i],
        ['End', 'commutes', /commutes/i],
      ] as const) {
        const current = screen.getByRole('tab', { selected: true });
        expect(fireEvent.keyDown(current, { key })).toBe(false);
        expect(onChange).toHaveBeenLastCalledWith(expectedKey);
        act(() => { frames.splice(0).forEach(callback => callback(0)); });
        const selected = screen.getByRole('tab', { selected: true });
        expect(selected).toHaveAccessibleName(name);
        expect(selected).toHaveFocus();
        expect(selected).toHaveAttribute('tabIndex', '0');
        for (const other of screen.getAllByRole('tab', { selected: false })) {
          expect(other).toHaveAttribute('tabIndex', '-1');
        }
        expect(screen.getByRole('tab', { name: 'Tagged' })).toBeDisabled();
        expect(screen.getByRole('tab', { name: 'Tagged' })).not.toHaveFocus();
      }
      expect(onChange.mock.calls).toEqual([['all'], ['commutes'], ['notable'], ['all'], ['commutes']]);
    } finally {
      animationFrame.mockRestore();
    }
  });
});
