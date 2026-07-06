/**
 * CommandQuickActionsWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of CommandQuickActionsWidget.tsx:
 *   - `visibleCommandsForSize` — the pure size→command-set selector (the
 *     compact / medium / wide branches, the ordering guarantee, and the
 *     defensive fallback for a malformed persisted size), and
 *   - `COMMANDS` — the ordered command catalog the selector slices, and
 *   - the default widget component across every render branch: the medium /
 *     wide / compact layout variants, the loading / empty states, the
 *     first-vehicle vs explicit-vehicleId resolution, the command dispatch
 *     interaction (including the "running" spinner + aria-busy + sibling
 *     disable), the settle→reset path, and the manual-refresh control.
 *
 * Strategy (mirrors the repo convention, e.g. BatteryCellsWidget.test.tsx and
 * ChargeStatusLiveWidget.test.tsx):
 *   - The two data hooks (`useVehicles`, `useVehicleCommand`) are replaced with
 *     hoisted `vi.fn()` doubles so the network is never touched and every
 *     render is deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback string so
 *     assertions read the real English copy (and command aria-labels).
 *   - The global test-setup already mocks `useSettings` and `useTimezone`,
 *     which the transitive <DataFreshness> header (rendered by <WidgetShell>)
 *     depends on.
 *   - Renders are wrapped in <MemoryRouter> for parity with the sibling widget
 *     tests (the shell's error branch renders <QueryError>, which uses Router).
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice
 * tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// jsdom lacks matchMedia; framer-motion (read transitively by
// useMotionPreference inside <DataFreshness>) touches it on first paint.
// Install a no-op before any import runs.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// react-i18next passthrough — resolve the fallback (2nd arg) so assertions read
// production copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

// Hoisted hook doubles — the network boundary. Never hit real endpoints.
const { vehiclesMock, commandMock, mutateMock } = vi.hoisted(() => ({
  vehiclesMock: vi.fn(),
  commandMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));
vi.mock('@/api/hooks/useVehicleCommand', () => ({ useVehicleCommand: commandMock }));

import CommandQuickActionsWidget, {
  visibleCommandsForSize,
  COMMANDS,
} from './CommandQuickActionsWidget';
import type { WidgetSize } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_MEDIUM: WidgetSize = { cols: 2, rows: 2 };
const SIZE_WIDE: WidgetSize = { cols: 4, rows: 3 };

interface VehiclesOverrides {
  data?: { id: number }[] | undefined;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeVehiclesQuery(over: VehiclesOverrides = {}) {
  return {
    data: [{ id: 42 }] as { id: number }[] | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vehiclesMock.mockReset();
  commandMock.mockReset();
  mutateMock.mockReset();
  // Sensible defaults: one vehicle loaded, a ready mutation. Individual tests
  // override as needed.
  vehiclesMock.mockReturnValue(makeVehiclesQuery());
  commandMock.mockReturnValue({ mutate: mutateMock });
});

// ── visibleCommandsForSize + COMMANDS (pure) ─────────────────────────────────
describe('visibleCommandsForSize', () => {
  it('selects 4 (compact), 6 (medium) and 8 (wide) commands by size', () => {
    expect(visibleCommandsForSize(SIZE_COMPACT)).toHaveLength(4);
    expect(visibleCommandsForSize(SIZE_MEDIUM)).toHaveLength(6);
    expect(visibleCommandsForSize({ cols: 3, rows: 2 })).toHaveLength(8);
    // The full (wide) set is the entire ordered catalog.
    expect(visibleCommandsForSize(SIZE_WIDE)).toEqual(COMMANDS);
    expect(COMMANDS).toHaveLength(8);
  });

  it('returns the leading slice of COMMANDS so the primary actions stay first', () => {
    // Compact keeps the four most-used actions, in catalog order.
    expect(visibleCommandsForSize(SIZE_COMPACT)).toEqual(COMMANDS.slice(0, 4));
    expect(visibleCommandsForSize(SIZE_COMPACT).map((c) => c.command)).toEqual([
      'lock',
      'unlock',
      'climate_on',
      'climate_off',
    ]);
  });

  it('treats a single-column tall tile as medium (compact needs 1×1)', () => {
    // The widget's minSize is 1×2, so the realistic smallest tile is NOT
    // compact — it must fall through to the 6-command medium set.
    expect(visibleCommandsForSize({ cols: 1, rows: 8 })).toHaveLength(6);
  });

  it('falls back to the medium set for a missing/malformed size (never throws)', () => {
    expect(visibleCommandsForSize(undefined as unknown as WidgetSize)).toHaveLength(6);
    expect(visibleCommandsForSize({} as WidgetSize)).toHaveLength(6);
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('CommandQuickActionsWidget', () => {
  it('renders the title and the 6-command medium set (Flash/Trunk are wide-only)', () => {
    renderWidget(<CommandQuickActionsWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    // Medium tiles carry a visible text label alongside the icon.
    expect(screen.getByText('Climate On')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lock' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Horn' })).toBeInTheDocument();
    // The 7th/8th commands only appear once the tile is wide.
    expect(screen.queryByRole('button', { name: 'Flash' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Trunk' })).not.toBeInTheDocument();
  });

  it('renders the full command set at wide size (adds Flash + Trunk)', () => {
    renderWidget(<CommandQuickActionsWidget size={SIZE_WIDE} />);

    expect(screen.getByRole('button', { name: 'Flash' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Trunk' })).toBeInTheDocument();
    for (const cmd of COMMANDS) {
      expect(screen.getByRole('button', { name: cmd.labelFallback })).toBeInTheDocument();
    }
  });

  it('renders the compact icon-only layout: no title, 4 tiles, no text labels', () => {
    renderWidget(<CommandQuickActionsWidget size={SIZE_COMPACT} />);

    // 1×1 tile suppresses the title chrome.
    expect(screen.queryByText('Quick Actions')).not.toBeInTheDocument();
    // Tiles are still reachable/announced via aria-label...
    expect(screen.getByRole('button', { name: 'Lock' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Climate Off' })).toBeInTheDocument();
    // ...but the visible text label is dropped (icon-only), and the 5th
    // command (Frunk) is not part of the compact set.
    expect(screen.queryByText('Climate Off')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Frunk' })).not.toBeInTheDocument();
  });

  it('dispatches the command for the first vehicle and enters the running state', () => {
    mutateMock.mockImplementation(() => {
      /* leave the mutation in-flight so the running UI is observable */
    });

    renderWidget(<CommandQuickActionsWidget size={SIZE_MEDIUM} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith(
      { vehicleId: 42, command: 'lock' },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );

    // The clicked tile swaps its icon for a spinner and marks itself busy...
    const lockBtn = screen.getByRole('button', { name: 'Lock' });
    expect(lockBtn.querySelector('.animate-spin')).toBeTruthy();
    expect(lockBtn).toHaveAttribute('aria-busy', 'true');
    // ...and every sibling tile is disabled to prevent a concurrent command.
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('clears the running state once the mutation settles', () => {
    // Settle synchronously via the onSettled callback the widget passes.
    mutateMock.mockImplementation((_args: unknown, opts?: { onSettled?: () => void }) => {
      opts?.onSettled?.();
    });

    renderWidget(<CommandQuickActionsWidget size={SIZE_MEDIUM} />);
    const lockBtn = screen.getByRole('button', { name: 'Lock' });
    fireEvent.click(lockBtn);

    expect(mutateMock).toHaveBeenCalledTimes(1);
    // activeCommand is reset → no spinner, no aria-busy, tiles re-enabled.
    expect(lockBtn.querySelector('.animate-spin')).toBeNull();
    expect(lockBtn).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Unlock' })).not.toBeDisabled();
  });

  it('uses the explicit vehicleId prop instead of the first vehicle', () => {
    renderWidget(<CommandQuickActionsWidget vehicleId={7} size={SIZE_MEDIUM} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(mutateMock).toHaveBeenCalledWith(
      { vehicleId: 7, command: 'unlock' },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
  });

  it('shows the empty state (and no command tiles) when there is no vehicle', () => {
    vehiclesMock.mockReturnValue(makeVehiclesQuery({ data: [], dataUpdatedAt: 0 }));

    renderWidget(<CommandQuickActionsWidget size={SIZE_MEDIUM} />);

    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock' })).not.toBeInTheDocument();
  });

  it('shows a loading skeleton (not the empty state) while resolving the vehicle id', () => {
    vehiclesMock.mockReturnValue(
      makeVehiclesQuery({ data: undefined, isLoading: true, dataUpdatedAt: 0 }),
    );

    const { container } = renderWidget(<CommandQuickActionsWidget size={SIZE_MEDIUM} />);

    // The shell renders its skeleton instead of flashing "No vehicle selected".
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('No vehicle selected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lock' })).not.toBeInTheDocument();
  });

  it('keeps the grid actionable during load when an explicit vehicleId is supplied', () => {
    vehiclesMock.mockReturnValue(
      makeVehiclesQuery({ data: undefined, isLoading: true, dataUpdatedAt: 0 }),
    );

    const { container } = renderWidget(
      <CommandQuickActionsWidget vehicleId={7} size={SIZE_MEDIUM} />,
    );

    // id is known up-front → no skeleton, the command grid is usable.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByRole('button', { name: 'Lock' })).toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    vehiclesMock.mockReturnValue(makeVehiclesQuery({ refetch, isFetching: false }));

    renderWidget(<CommandQuickActionsWidget size={SIZE_MEDIUM} />);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
