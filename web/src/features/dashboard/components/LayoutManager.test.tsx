/**
 * LayoutManager — behavioural contract tests.
 *
 * The LayoutManager renders the dashboard-layout switcher: a horizontal strip
 * of draggable "tab" chips plus a create affordance, with a right-click context
 * menu (rename / duplicate / settings / delete) layered on top. It owns a fair
 * amount of local UI state (inline rename, inline create, drag ordering, and a
 * viewport-clamped context menu) but delegates every mutation to callbacks, so
 * these tests exercise:
 *   - tab rendering (icon fallback, default badge, active `aria-current`),
 *   - switch via click AND keyboard (the a11y parity path),
 *   - the create flow: templates shortcut vs inline input, trim, whitespace
 *     rejection, Enter / confirm-button / Escape / cancel-button,
 *   - the context menu: open on right-click, duplicate/settings/delete wiring,
 *     delete disabled for the default layout (the CtxItem disabled branch),
 *     and close-on-Escape / close-on-outside-click,
 *   - inline rename: enter from the menu, trim, empty rejection, Escape,
 *   - drag-to-reorder (from/to wiring + same-index no-op),
 *   - null-safety when `dashboards` is empty or (defensively) undefined.
 *
 * `@testing-library/user-event` is not installed in this repo (see
 * EditableText.test), so interactions are driven with `fireEvent`. Drag events
 * are given a stub `DataTransfer` because jsdom does not implement one and the
 * source reads `effectAllowed` / calls `setDragImage`. `react-i18next` is
 * stubbed to a passthrough `t(key, default)` (repo convention) so aria-labels
 * and visible text resolve to their English defaults. No network is touched and
 * the component needs neither Router nor QueryClient.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string | Record<string, unknown>) =>
      typeof defaultValue === 'string' ? defaultValue : key,
  }),
}));

import { LayoutManager } from './LayoutManager';
import type { SavedDashboard } from '../widgets/types';

type Props = ComponentProps<typeof LayoutManager>;

function makeDash(over: Partial<SavedDashboard> = {}): SavedDashboard {
  return {
    id: 'a',
    name: 'Alpha',
    widgets: [],
    layouts: {},
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}

const THREE = (): SavedDashboard[] => [
  makeDash({ id: 'a', name: 'Alpha', icon: '🚗' }),
  makeDash({ id: 'b', name: 'Bravo' }),
  makeDash({ id: 'c', name: 'Charlie' }),
];

function renderManager(over: Partial<Props> = {}) {
  const props: Props = {
    dashboards: THREE(),
    activeId: 'a',
    onSwitch: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onDuplicate: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
  const utils = render(<LayoutManager {...props} />);
  return { ...utils, props };
}

/** jsdom lacks DataTransfer; the drag handlers read/write it, so stub it. */
function makeDataTransfer(): DataTransfer {
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setDragImage: vi.fn(),
    setData: vi.fn(),
    getData: vi.fn(() => ''),
  } as unknown as DataTransfer;
}

const tab = (name: RegExp) => screen.getByRole('button', { name });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LayoutManager — tab rendering', () => {
  it('renders one keyboard-focusable tab per dashboard with icon fallback and default badge', () => {
    renderManager({
      dashboards: [
        makeDash({ id: 'a', name: 'Alpha', icon: '🚗' }),
        makeDash({ id: 'b', name: 'Bravo', isDefault: true }),
      ],
    });

    const alpha = tab(/Alpha/);
    const bravo = tab(/Bravo/);
    expect(alpha).toBeInTheDocument();
    expect(bravo).toBeInTheDocument();
    // Custom icon is shown for Alpha; Bravo (no icon) falls back to 📊.
    expect(screen.getByText('🚗')).toBeInTheDocument();
    expect(screen.getByText('📊')).toBeInTheDocument();
    // The default layout is badged.
    expect(within(bravo).getByText('default')).toBeInTheDocument();
    // Tabs participate in the tab order (keyboard-operable).
    expect(alpha).toHaveAttribute('tabindex', '0');
  });

  it('marks only the active tab with aria-current', () => {
    renderManager({ dashboards: THREE(), activeId: 'b' });
    expect(tab(/Bravo/)).toHaveAttribute('aria-current', 'true');
    expect(tab(/Alpha/)).not.toHaveAttribute('aria-current');
    expect(tab(/Charlie/)).not.toHaveAttribute('aria-current');
  });

  it('decorates the icon as aria-hidden so the accessible name is just the layout name', () => {
    renderManager({ dashboards: [makeDash({ id: 'a', name: 'Alpha', icon: '🚗' })] });
    expect(screen.getByText('🚗')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('LayoutManager — switching', () => {
  it('calls onSwitch with the clicked tab id', () => {
    const { props } = renderManager({ activeId: 'a' });
    fireEvent.click(tab(/Charlie/));
    expect(props.onSwitch).toHaveBeenCalledTimes(1);
    expect(props.onSwitch).toHaveBeenCalledWith('c');
  });

  it('switches via keyboard on Enter and Space (a11y parity)', () => {
    const { props } = renderManager({ activeId: 'a' });
    const bravo = tab(/Bravo/);
    fireEvent.keyDown(bravo, { key: 'Enter' });
    fireEvent.keyDown(bravo, { key: ' ' });
    expect(props.onSwitch).toHaveBeenCalledTimes(2);
    expect(props.onSwitch).toHaveBeenNthCalledWith(1, 'b');
    expect(props.onSwitch).toHaveBeenNthCalledWith(2, 'b');
  });

  it('ignores unrelated keys on a focused tab', () => {
    const { props } = renderManager();
    fireEvent.keyDown(tab(/Alpha/), { key: 'a' });
    expect(props.onSwitch).not.toHaveBeenCalled();
  });
});

describe('LayoutManager — create flow', () => {
  it('opens an inline input and creates a trimmed layout on Enter', () => {
    const { props } = renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'New Layout' }));

    const input = screen.getByPlaceholderText('Layout name...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Road Trips  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect(props.onCreate).toHaveBeenCalledWith('Road Trips');
    // Input closes after a successful create.
    expect(screen.queryByPlaceholderText('Layout name...')).not.toBeInTheDocument();
  });

  it('creates via the confirm (check) button', () => {
    const { props } = renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'New Layout' }));
    fireEvent.change(screen.getByPlaceholderText('Layout name...'), {
      target: { value: 'Weekend' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm create' }));
    expect(props.onCreate).toHaveBeenCalledWith('Weekend');
  });

  it('does not create when the name is blank / whitespace but still closes the input', () => {
    const { props } = renderManager();
    fireEvent.click(screen.getByRole('button', { name: 'New Layout' }));
    const input = screen.getByPlaceholderText('Layout name...');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Layout name...')).not.toBeInTheDocument();
  });

  it('cancels the create input on Escape and via the cancel (x) button without creating', () => {
    const { props } = renderManager();
    // Escape path.
    fireEvent.click(screen.getByRole('button', { name: 'New Layout' }));
    fireEvent.keyDown(screen.getByPlaceholderText('Layout name...'), { key: 'Escape' });
    expect(screen.queryByPlaceholderText('Layout name...')).not.toBeInTheDocument();

    // Cancel-button path.
    fireEvent.click(screen.getByRole('button', { name: 'New Layout' }));
    fireEvent.change(screen.getByPlaceholderText('Layout name...'), {
      target: { value: 'Discarded' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel create' }));
    expect(screen.queryByPlaceholderText('Layout name...')).not.toBeInTheDocument();
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  it('delegates to onOpenTemplates instead of showing the inline input when provided', () => {
    const onOpenTemplates = vi.fn();
    const { props } = renderManager({ onOpenTemplates });
    fireEvent.click(screen.getByRole('button', { name: 'New Layout' }));

    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('Layout name...')).not.toBeInTheDocument();
  });
});

describe('LayoutManager — context menu', () => {
  it('opens on right-click and exposes rename / duplicate / settings / delete', () => {
    renderManager();
    fireEvent.contextMenu(tab(/Bravo/));

    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('wires Duplicate to onDuplicate with the right id and closes the menu', () => {
    const { props } = renderManager();
    fireEvent.contextMenu(tab(/Bravo/));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    expect(props.onDuplicate).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
  });

  it('wires Settings to onOpenSettings with the right id', () => {
    const { props } = renderManager();
    fireEvent.contextMenu(tab(/Charlie/));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(props.onOpenSettings).toHaveBeenCalledWith('c');
  });

  it('wires Delete to onDelete for a non-default layout', () => {
    const { props } = renderManager();
    fireEvent.contextMenu(tab(/Bravo/));
    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).not.toBeDisabled();
    fireEvent.click(del);
    expect(props.onDelete).toHaveBeenCalledWith('b');
  });

  it('disables Delete for the default layout (CtxItem disabled + danger branch)', () => {
    const { props } = renderManager({
      dashboards: [makeDash({ id: 'a', name: 'Alpha', isDefault: true })],
    });
    fireEvent.contextMenu(tab(/Alpha/));
    const del = screen.getByRole('button', { name: 'Delete' });
    expect(del).toBeDisabled();
    expect(del.className).toContain('text-red-400');
    fireEvent.click(del);
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it('closes on Escape and on an outside click', () => {
    renderManager();

    fireEvent.contextMenu(tab(/Alpha/));
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();

    fireEvent.contextMenu(tab(/Alpha/));
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
  });
});

describe('LayoutManager — rename flow', () => {
  it('enters inline rename from the menu and renames with a trimmed value on Enter', () => {
    const { props } = renderManager();
    fireEvent.contextMenu(tab(/Alpha/));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('Alpha');
    fireEvent.change(input, { target: { value: '  Alpha 2  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onRename).toHaveBeenCalledWith('a', 'Alpha 2');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('does not rename to an empty value but still exits edit mode', () => {
    const { props } = renderManager();
    fireEvent.contextMenu(tab(/Alpha/));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cancels rename on Escape and via the cancel button without calling onRename', () => {
    const { props } = renderManager();

    fireEvent.contextMenu(tab(/Alpha/));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nope' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.contextMenu(tab(/Alpha/));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nope2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel rename' }));

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('renames via the confirm button', () => {
    const { props } = renderManager();
    fireEvent.contextMenu(tab(/Charlie/));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Gamma' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rename' }));
    expect(props.onRename).toHaveBeenCalledWith('c', 'Gamma');
  });
});

describe('LayoutManager — drag reorder', () => {
  it('calls onReorder(from, to) when a tab is dropped on another', () => {
    const { props } = renderManager();
    const dt = makeDataTransfer();
    fireEvent.dragStart(tab(/Alpha/), { dataTransfer: dt });
    fireEvent.dragOver(tab(/Charlie/), { dataTransfer: dt });
    fireEvent.drop(tab(/Charlie/), { dataTransfer: dt });
    expect(props.onReorder).toHaveBeenCalledTimes(1);
    expect(props.onReorder).toHaveBeenCalledWith(0, 2);
  });

  it('does not reorder when a tab is dropped onto itself', () => {
    const { props } = renderManager();
    const dt = makeDataTransfer();
    fireEvent.dragStart(tab(/Bravo/), { dataTransfer: dt });
    fireEvent.drop(tab(/Bravo/), { dataTransfer: dt });
    expect(props.onReorder).not.toHaveBeenCalled();
  });
});

describe('LayoutManager — null safety', () => {
  it('renders only the create affordance when there are no dashboards', () => {
    renderManager({ dashboards: [], activeId: '' });
    expect(screen.getByRole('button', { name: 'New Layout' })).toBeInTheDocument();
    expect(screen.queryByText('📊')).not.toBeInTheDocument();
  });

  it('does not crash when dashboards is undefined (defensive coercion)', () => {
    expect(() =>
      renderManager({ dashboards: undefined as unknown as SavedDashboard[] }),
    ).not.toThrow();
    expect(screen.getByRole('button', { name: 'New Layout' })).toBeInTheDocument();
  });
});
