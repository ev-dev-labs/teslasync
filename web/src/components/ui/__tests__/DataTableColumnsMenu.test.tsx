/**
 * `<DataTableColumnsMenu>` behaviour contract.
 *
 * Locks in the user-facing semantics DataTable relies on:
 *   1. Default trigger renders an accessible "Columns" popover button; the
 *      popover starts closed and toggles open/closed.
 *   2. A custom `trigger` render-prop receives a toggle callback.
 *   3. Each column renders a checkbox whose checked state mirrors `visibleKeys`.
 *   4. Toggling emits a fresh key list in SOURCE COLUMN ORDER (add + remove).
 *   5. The last visible column can never be hidden (checkbox disabled + no-op).
 *   6. `required` columns are always visible: rendered checked + disabled, and
 *      always injected into the emitted list even when absent from `visibleKeys`.
 *   7. "Show all" emits every column key.
 *   8. Empty `columns` renders an empty state and disables "Show all" (never a
 *      blank panel).
 *   9. Escape / outside-click dismiss; inside-click keeps the popover open.
 *  10. a11y: aria-haspopup / aria-expanded on the trigger, role="menu" + label.
 *
 * i18n is initialised so `t(key, fallback)` resolves to the English fallback.
 */

import '@/i18n';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { useState } from 'react';
import { DataTableColumnsMenu } from '../DataTableColumnsMenu';

interface Col {
  key: string;
  header: string;
  required?: boolean;
}

const COLS: Col[] = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'role', header: 'Role' },
];

afterEach(cleanup);

const TRIGGER = { name: /show or hide columns/i } as const;

function openMenu(): HTMLElement {
  fireEvent.click(screen.getByRole('button', TRIGGER));
  return screen.getByRole('menu', TRIGGER);
}

/** Controlled harness mirroring how DataTable feeds visibleKeys + onChange. */
function Harness({
  columns = COLS,
  initial,
  onChangeSpy,
}: {
  columns?: Col[];
  initial: string[];
  onChangeSpy?: (next: string[]) => void;
}) {
  const [visible, setVisible] = useState(initial);
  return (
    <DataTableColumnsMenu
      columns={columns}
      visibleKeys={visible}
      onChange={(next) => {
        onChangeSpy?.(next);
        setVisible(next);
      }}
    />
  );
}

describe('DataTableColumnsMenu — trigger + open/close', () => {
  it('renders the default trigger and keeps the popover closed initially', () => {
    render(<Harness initial={['name', 'email', 'role']} />);
    const trigger = screen.getByRole('button', TRIGGER);
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Columns');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the popover and lists every column as a checkbox', () => {
    render(<Harness initial={['name', 'email', 'role']} />);
    const menu = openMenu();
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('button', TRIGGER)).toHaveAttribute('aria-expanded', 'true');
    const boxes = within(menu).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect(within(menu).getByRole('checkbox', { name: 'Name' })).toBeInTheDocument();
    expect(within(menu).getByRole('checkbox', { name: 'Email' })).toBeInTheDocument();
    expect(within(menu).getByRole('checkbox', { name: 'Role' })).toBeInTheDocument();
  });

  it('supports a custom trigger render-prop that toggles the popover', () => {
    const onChange = vi.fn();
    render(
      <DataTableColumnsMenu
        columns={COLS}
        visibleKeys={['name', 'email', 'role']}
        onChange={onChange}
        trigger={(toggle) => (
          <button type="button" onClick={toggle}>
            Pick columns
          </button>
        )}
      />,
    );
    // The default trigger is replaced entirely.
    expect(screen.queryByRole('button', TRIGGER)).toBeNull();
    const custom = screen.getByRole('button', { name: 'Pick columns' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(custom);
    expect(screen.getByRole('menu', TRIGGER)).toBeInTheDocument();
    // Toggling again closes it.
    fireEvent.click(custom);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<Harness initial={['name', 'email', 'role']} />);
    openMenu();
    expect(screen.getByRole('menu', TRIGGER)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', TRIGGER)).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on outside mousedown but stays open on inside mousedown', () => {
    render(
      <div>
        <Harness initial={['name', 'email', 'role']} />
        <button type="button">outside</button>
      </div>,
    );
    const menu = openMenu();
    // Pointer down inside the menu must NOT dismiss it.
    fireEvent.mouseDown(within(menu).getByRole('checkbox', { name: 'Email' }));
    expect(screen.getByRole('menu', TRIGGER)).toBeInTheDocument();
    // Pointer down outside dismisses it.
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('DataTableColumnsMenu — visibility state', () => {
  it('checks visible columns and unchecks hidden ones', () => {
    render(<Harness initial={['name']} />);
    const menu = openMenu();
    expect(within(menu).getByRole('checkbox', { name: 'Name' })).toBeChecked();
    expect(within(menu).getByRole('checkbox', { name: 'Email' })).not.toBeChecked();
    expect(within(menu).getByRole('checkbox', { name: 'Role' })).not.toBeChecked();
  });

  it('adds a hidden column in source column order when toggled on', () => {
    const spy = vi.fn();
    render(<Harness initial={['name']} onChangeSpy={spy} />);
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Role' }));
    // Column order is name,email,role — email stays hidden, role slots after name.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(['name', 'role']);
  });

  it('removes a visible column when toggled off', () => {
    const spy = vi.fn();
    render(<Harness initial={['name', 'email', 'role']} onChangeSpy={spy} />);
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Email' }));
    expect(spy).toHaveBeenCalledWith(['name', 'role']);
  });

  it('reflects the toggle immediately via the controlled round-trip', () => {
    render(<Harness initial={['name', 'email', 'role']} />);
    const menu = openMenu();
    const email = within(menu).getByRole('checkbox', { name: 'Email' });
    expect(email).toBeChecked();
    fireEvent.click(email);
    expect(within(menu).getByRole('checkbox', { name: 'Email' })).not.toBeChecked();
  });
});

describe('DataTableColumnsMenu — guards', () => {
  it('disables the last visible checkbox and refuses to hide it', () => {
    const spy = vi.fn();
    render(
      <DataTableColumnsMenu columns={COLS} visibleKeys={['name']} onChange={spy} />,
    );
    const menu = openMenu();
    const name = within(menu).getByRole('checkbox', { name: 'Name' });
    expect(name).toBeChecked();
    expect(name).toBeDisabled();
    // A disabled checkbox does not fire change events.
    fireEvent.click(name);
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps required columns checked and disabled even when absent from visibleKeys', () => {
    const cols: Col[] = [
      { key: 'sel', header: 'Select', required: true },
      { key: 'name', header: 'Name' },
      { key: 'email', header: 'Email' },
    ];
    render(
      <DataTableColumnsMenu columns={cols} visibleKeys={['name']} onChange={vi.fn()} />,
    );
    openMenu();
    const required = screen.getByTestId('datatable-columns-menu-checkbox-sel');
    // Required column is always treated as visible → checked, and locked.
    expect(required).toBeChecked();
    expect(required).toBeDisabled();
  });

  it('always injects required columns into the emitted list when toggling another', () => {
    const spy = vi.fn();
    const cols: Col[] = [
      { key: 'sel', header: 'Select', required: true },
      { key: 'name', header: 'Name' },
      { key: 'email', header: 'Email' },
    ];
    render(<DataTableColumnsMenu columns={cols} visibleKeys={['name']} onChange={spy} />);
    const menu = openMenu();
    fireEvent.click(within(menu).getByRole('checkbox', { name: 'Email' }));
    // sel is required so it is present even though it was not in visibleKeys.
    expect(spy).toHaveBeenCalledWith(['sel', 'name', 'email']);
  });

  it('ignores clicks on a required column checkbox', () => {
    const spy = vi.fn();
    const cols: Col[] = [
      { key: 'sel', header: 'Select', required: true },
      { key: 'name', header: 'Name' },
    ];
    render(
      <DataTableColumnsMenu columns={cols} visibleKeys={['sel', 'name']} onChange={spy} />,
    );
    openMenu();
    fireEvent.click(screen.getByTestId('datatable-columns-menu-checkbox-sel'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('DataTableColumnsMenu — show all + empty state', () => {
  it('emits every column key when "Show all" is clicked', () => {
    const spy = vi.fn();
    render(<Harness initial={['name']} onChangeSpy={spy} />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(spy).toHaveBeenCalledWith(['name', 'email', 'role']);
  });

  it('renders an empty state and disables "Show all" when there are no columns', () => {
    render(<DataTableColumnsMenu columns={[]} visibleKeys={[]} onChange={vi.fn()} />);
    const menu = openMenu();
    expect(within(menu).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(menu).getByText('No columns to configure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all' })).toBeDisabled();
  });
});

describe('DataTableColumnsMenu — a11y + fallbacks', () => {
  it('exposes menu semantics on the trigger and popover', () => {
    render(<Harness initial={['name', 'email']} />);
    const trigger = screen.getByRole('button', TRIGGER);
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const menu = openMenu();
    expect(menu).toHaveAttribute('aria-label', 'Show or hide columns');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('falls back to the column key when the header is empty', () => {
    const cols: Col[] = [
      { key: 'sel', header: '' },
      { key: 'name', header: 'Name' },
    ];
    render(
      <DataTableColumnsMenu columns={cols} visibleKeys={['sel', 'name']} onChange={vi.fn()} />,
    );
    const menu = openMenu();
    // The empty header renders the key text, which also names the checkbox.
    expect(within(menu).getByRole('checkbox', { name: 'sel' })).toBeInTheDocument();
  });
});
