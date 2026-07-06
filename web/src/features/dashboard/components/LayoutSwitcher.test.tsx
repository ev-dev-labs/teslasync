/**
 * LayoutSwitcher — behavioural coverage + hardening regression tests.
 *
 * LayoutSwitcher is the compact dropdown that switches between saved dashboard
 * layouts. It owns no network of its own — the parent injects the layout list,
 * the active id, and a fistful of callbacks (switch / create / duplicate /
 * reset / pin / toggle-edit). The two environment hooks it reaches for
 * (`useSelectedVehicle`, `useConfirm`) are mocked so every branch is driven
 * deterministically without a QueryClient / Router.
 *
 * Facets covered:
 *   - closed-state trigger: active name, the "Layout" label, the dirty badge,
 *     and the collapsed aria-haspopup/aria-expanded contract.
 *   - opening the menu: visible layouts render as menuitemradio, the active one
 *     is aria-checked, switching fires onSwitch and closes the menu.
 *   - vehicle-scope filtering: a layout pinned to a different vehicle is hidden;
 *     user-global + same-vehicle layouts stay; an empty scope shows its message.
 *   - Save-As: the create path forwards the TRIMMED typed name to onCreate; the
 *     duplicate path forwards the typed name to onDuplicate (regression for the
 *     dropped-name bug); cancel / whitespace is a no-op.
 *   - Reset: routes through the promise-based confirm — accepted calls onReset,
 *     declined does not.
 *   - Pin toggle: pin / unpin / disabled-when-no-vehicle.
 *   - pinnedLabel resolves the vehicle the ACTIVE layout is pinned to (not the
 *     currently-selected one) and falls back to `#id` (regression for the
 *     wrong-vehicle bug).
 *   - a11y: icon-only reset button has an accessible name; Escape / outside
 *     click close the menu; the edit toggle reflects state via aria-pressed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LayoutSwitcher } from './LayoutSwitcher';
import type { SavedDashboard } from '../widgets/types';
import type { Vehicle } from '@/types/vehicle';

// ── i18n stub: return the English fallback, interpolating {{var}} options. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Environment hooks, driven per test. ──
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useConfirm', () => ({ useConfirm: vi.fn() }));

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useConfirm } from '@/hooks/useConfirm';

const mockSelected = vi.mocked(useSelectedVehicle);
const mockUseConfirm = vi.mocked(useConfirm);

// Shared confirm spy — the boolean it resolves to is set per test.
let confirmResolvesTo = true;
const confirmSpy = vi.fn(() => Promise.resolve(confirmResolvesTo));

let promptSpy: ReturnType<typeof vi.spyOn>;

function mkDash(over: Partial<SavedDashboard> = {}): SavedDashboard {
  return {
    id: 'main',
    name: 'Main',
    widgets: [],
    layouts: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}

function mkVehicles(...v: Array<Partial<Vehicle>>): Vehicle[] {
  return v as unknown as Vehicle[];
}

interface SetupOpts {
  dashboards?: SavedDashboard[];
  activeId?: string;
  dirty?: boolean;
  editMode?: boolean;
  withDuplicate?: boolean;
  withToggleEdit?: boolean;
  withPin?: boolean;
  vehicleId?: number | null;
  vehicles?: Vehicle[];
}

function setup(opts: SetupOpts = {}) {
  const dashboards = opts.dashboards ?? [mkDash()];
  const activeId = opts.activeId ?? dashboards[0]?.id ?? 'main';

  mockSelected.mockReturnValue({
    vehicleId: opts.vehicleId ?? null,
    vehicle: null,
    vehicles: opts.vehicles ?? [],
    setVehicleId: vi.fn(),
  });

  const handlers = {
    onSwitch: vi.fn(),
    onCreate: vi.fn(() => 'new-id'),
    onDuplicate: vi.fn(),
    onReset: vi.fn(),
    onToggleEdit: vi.fn(),
    onPinToVehicle: vi.fn(),
  };

  const utils = render(
    <LayoutSwitcher
      dashboards={dashboards}
      activeId={activeId}
      dirty={opts.dirty}
      editMode={opts.editMode}
      onSwitch={handlers.onSwitch}
      onCreate={handlers.onCreate}
      onDuplicate={opts.withDuplicate === false ? undefined : handlers.onDuplicate}
      onReset={handlers.onReset}
      onToggleEdit={opts.withToggleEdit === false ? undefined : handlers.onToggleEdit}
      onPinToVehicle={opts.withPin === false ? undefined : handlers.onPinToVehicle}
    />,
  );

  return { ...utils, ...handlers, dashboards, activeId };
}

const trigger = () => screen.getByRole('button', { name: 'Switch dashboard layout' });
const openMenu = () => fireEvent.click(trigger());

beforeEach(() => {
  confirmResolvesTo = true;
  confirmSpy.mockClear();
  mockUseConfirm.mockReturnValue({
    confirm: confirmSpy,
    dialogProps: null,
  } as unknown as ReturnType<typeof useConfirm>);
  mockSelected.mockReturnValue({
    vehicleId: null,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  });
  promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  promptSpy.mockRestore();
});

describe('LayoutSwitcher', () => {
  it('renders the trigger with the active name + Layout label and a collapsed menu', () => {
    setup({ dirty: true });

    const btn = trigger();
    expect(btn).toHaveAttribute('aria-haspopup', 'menu');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(within(btn).getByText('Layout')).toBeInTheDocument();
    expect(within(btn).getByText('Main')).toBeInTheDocument();
    // Dirty ⇒ the "modified" badge is present.
    expect(screen.getByText('modified')).toBeInTheDocument();
    // Menu is not mounted until opened.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('omits the modified badge when the layout is clean', () => {
    setup({ dirty: false });
    expect(screen.queryByText('modified')).not.toBeInTheDocument();
  });

  it('opens the menu, lists visible layouts and marks the active one as checked', () => {
    setup({
      dashboards: [mkDash({ id: 'main', name: 'Main' }), mkDash({ id: 'alt', name: 'Alternate' })],
      activeId: 'main',
    });

    openMenu();

    const menu = screen.getByRole('menu', { name: 'Saved layouts' });
    expect(menu).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');

    const mainItem = screen.getByRole('menuitemradio', { name: 'Main' });
    const altItem = screen.getByRole('menuitemradio', { name: 'Alternate' });
    expect(mainItem).toHaveAttribute('aria-checked', 'true');
    expect(altItem).toHaveAttribute('aria-checked', 'false');
  });

  it('switches to the clicked layout and closes the menu', () => {
    const { onSwitch } = setup({
      dashboards: [mkDash({ id: 'main', name: 'Main' }), mkDash({ id: 'alt', name: 'Alternate' })],
      activeId: 'main',
    });

    openMenu();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Alternate' }));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith('alt');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('filters out layouts pinned to a different vehicle but keeps global + same-vehicle ones', () => {
    setup({
      dashboards: [
        mkDash({ id: 'g', name: 'Global' }),
        mkDash({ id: 'a', name: 'Pinned A', vehicleId: 1 }),
        mkDash({ id: 'b', name: 'Pinned B', vehicleId: 2 }),
      ],
      activeId: 'g',
      vehicleId: 1,
      vehicles: mkVehicles({ id: 1, display_name: 'Car One' }),
    });

    openMenu();

    expect(screen.getByRole('menuitemradio', { name: 'Global' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Pinned A' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Pinned B' })).not.toBeInTheDocument();
  });

  it('shows the empty-scope message when no layouts are visible for the vehicle', () => {
    setup({
      dashboards: [mkDash({ id: 'a', name: 'Pinned A', vehicleId: 1 })],
      activeId: 'a',
      vehicleId: 2,
      vehicles: mkVehicles({ id: 1, display_name: 'Car One' }, { id: 2, display_name: 'Car Two' }),
    });

    openMenu();

    expect(screen.getByText('No layouts available for this vehicle.')).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
  });

  it('creates a new layout with the trimmed typed name when no duplicate handler is wired', () => {
    promptSpy.mockReturnValue('  Fresh Layout  ');
    const { onCreate, onDuplicate } = setup({
      dashboards: [mkDash({ id: 'main', name: 'Main' })],
      activeId: 'main',
      withDuplicate: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save as new layout' }));

    expect(promptSpy).toHaveBeenCalledWith('Name for the new layout:', 'Main (Copy)');
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith('Fresh Layout');
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('forwards the typed name to onDuplicate instead of discarding it (dropped-name regression)', () => {
    promptSpy.mockReturnValue('My Custom Name');
    const { onDuplicate, onCreate } = setup({
      dashboards: [mkDash({ id: 'main', name: 'Main' })],
      activeId: 'main',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save as new layout' }));

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledWith('main', 'My Custom Name');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('treats a cancelled or whitespace-only Save-As name as a no-op', () => {
    const { onCreate, onDuplicate } = setup();

    // Cancelled prompt (null).
    promptSpy.mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Save as new layout' }));

    // Whitespace-only name trims to empty.
    promptSpy.mockReturnValue('   ');
    fireEvent.click(screen.getByRole('button', { name: 'Save as new layout' }));

    expect(promptSpy).toHaveBeenCalledTimes(2);
    expect(onCreate).not.toHaveBeenCalled();
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('resets to default when the confirm dialog is accepted', async () => {
    confirmResolvesTo = true;
    const { onReset } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    await waitFor(() => expect(onReset).toHaveBeenCalledTimes(1));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'danger', title: 'Reset dashboard to default?' }),
    );
  });

  it('does NOT reset when the confirm dialog is declined', async () => {
    confirmResolvesTo = false;
    const { onReset } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to default' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    expect(onReset).not.toHaveBeenCalled();
  });

  it('pins the active layout to the currently selected vehicle', () => {
    const { onPinToVehicle } = setup({
      dashboards: [mkDash({ id: 'main', name: 'Main' })],
      activeId: 'main',
      vehicleId: 5,
      vehicles: mkVehicles({ id: 5, display_name: 'Roadster' }),
    });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin to current vehicle' }));

    expect(onPinToVehicle).toHaveBeenCalledTimes(1);
    expect(onPinToVehicle).toHaveBeenCalledWith('main', 5);
  });

  it('unpins the active layout when it is already vehicle-scoped', () => {
    const { onPinToVehicle } = setup({
      dashboards: [mkDash({ id: 'main', name: 'Main', vehicleId: 5 })],
      activeId: 'main',
      vehicleId: 5,
      vehicles: mkVehicles({ id: 5, display_name: 'Roadster' }),
    });

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin from vehicle' }));

    expect(onPinToVehicle).toHaveBeenCalledTimes(1);
    expect(onPinToVehicle).toHaveBeenCalledWith('main', null);
  });

  it('disables the pin action when the layout is unpinned and no vehicle is selected', () => {
    const { onPinToVehicle } = setup({
      dashboards: [mkDash({ id: 'main', name: 'Main' })],
      activeId: 'main',
      vehicleId: null,
    });

    openMenu();
    const pinItem = screen.getByRole('menuitem', { name: 'Pin to current vehicle' });
    expect(pinItem).toBeDisabled();

    fireEvent.click(pinItem);
    expect(onPinToVehicle).not.toHaveBeenCalled();
  });

  it('labels the trigger with the pinned vehicle — not the selected one — and falls back to #id', () => {
    // Active is pinned to vehicle 2 while vehicle 1 is currently selected.
    const first = setup({
      dashboards: [mkDash({ id: 'main', name: 'Main', vehicleId: 2 })],
      activeId: 'main',
      vehicleId: 1,
      vehicles: mkVehicles(
        { id: 1, display_name: 'Selected Car' },
        { id: 2, display_name: 'Pinned Car', vin: 'VIN2' },
      ),
    });

    expect(within(trigger()).getByText('Pinned Car')).toBeInTheDocument();
    expect(within(trigger()).queryByText('Selected Car')).not.toBeInTheDocument();
    first.unmount();

    // Pinned vehicle absent from the loaded fleet ⇒ raw id fallback.
    setup({
      dashboards: [mkDash({ id: 'main', name: 'Main', vehicleId: 7 })],
      activeId: 'main',
      vehicleId: 1,
      vehicles: mkVehicles({ id: 1, display_name: 'Selected Car' }),
    });
    expect(within(trigger()).getByText('#7')).toBeInTheDocument();
  });

  it('reflects edit state through the toggle button and forwards clicks', () => {
    const { onToggleEdit, rerender, dashboards, activeId } = setup({ editMode: false });

    const editBtn = screen.getByRole('button', { name: 'Edit dashboard' });
    expect(editBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(editBtn);
    expect(onToggleEdit).toHaveBeenCalledTimes(1);

    rerender(
      <LayoutSwitcher
        dashboards={dashboards}
        activeId={activeId}
        editMode
        onSwitch={vi.fn()}
        onCreate={vi.fn()}
        onReset={vi.fn()}
        onToggleEdit={onToggleEdit}
      />,
    );
    const exitBtn = screen.getByRole('button', { name: 'Exit edit mode' });
    expect(exitBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('gives the icon-only reset button an accessible name and closes the menu on Escape / outside click', () => {
    setup();

    // Icon-only reset control still exposes a name for assistive tech.
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeInTheDocument();

    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    openMenu();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
