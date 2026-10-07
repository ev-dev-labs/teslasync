/**
 * SignalCategoryTree — behaviour + hardening coverage.
 *
 * SignalCategoryTree is a thin wrapper around the generic <TreeSelect>
 * primitive. It owns the domain logic worth testing:
 *   - grouping the available-signal catalog by `category`
 *   - applying friendly category labels (known → English, unknown → raw id)
 *   - the CATEGORY_ORDER ranking (known ranks first, unknown last alpha)
 *   - alphabetical leaf sort within each category
 *   - threading loading / error / empty states into TreeSelect
 *   - the lazy `renderLeafRight` sparkline slot + its `enabled` gating
 *     (expanded-group branch AND the search branch)
 *
 * TreeSelect is kept REAL so the actual accessible DOM (roles, aria-labels)
 * is exercised end-to-end. The data hook (`useAvailableSignals`) and the
 * heavy `SignalSparklinePreview` leaf child are stubbed — no network is hit
 * and the sparkline stub surfaces its props as data-attributes so the
 * gating logic is asserted directly. i18n is stubbed so visible copy is the
 * English fallback with {{placeholder}} interpolation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { SignalDescriptor, SignalKind } from '@/api/types';
import { SignalCategoryTree, type SignalCategoryTreeProps } from './SignalCategoryTree';

// ── Hoisted, per-test controllable query state ───────────────────────
const h = vi.hoisted(() => ({
  data: undefined as { signals: SignalDescriptor[] } | undefined,
  isLoading: false,
  isError: false,
  error: null as Error | null,
}));

vi.mock('@/api/hooks/useSignals', () => ({
  useAvailableSignals: () => ({
    data: h.data,
    isLoading: h.isLoading,
    isError: h.isError,
    error: h.error,
  }),
}));

// Leaf sparkline child — stubbed to a marker that echoes its props so the
// `enabled` gating + prop threading can be asserted without the underlying
// useSignalHistory fetch.
vi.mock('./SignalSparklinePreview', () => ({
  SignalSparklinePreview: ({
    vehicleId,
    signal,
    valueKind,
    enabled,
  }: {
    vehicleId: number;
    signal: string;
    valueKind: string;
    enabled: boolean;
  }) => (
    <span
      data-testid={`spark-${signal}`}
      data-vehicle={String(vehicleId)}
      data-kind={valueKind}
      data-enabled={String(enabled)}
    />
  ),
}));

// i18n → English fallback with {{placeholder}} interpolation.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────
function sig(name: string, category: string, value_kind: SignalKind = 'float'): SignalDescriptor {
  return { name, category, value_kind, unit_kind: 'none', is_compound: false, is_setting_unit: false };
}

// Categories intentionally shuffled + include two UNKNOWN ids to prove the
// rank-then-alpha ordering. Leaves within a category are intentionally out
// of alphabetical order to prove the in-category sort.
const SIGNALS: SignalDescriptor[] = [
  sig('Vin', 'metadata', 'string'),
  sig('VehicleSpeed', 'driving', 'float'),
  sig('Gear', 'driving', 'string'),
  sig('BatteryLevel', 'charging', 'float'),
  sig('ACChargingPower', 'charging', 'float'),
  sig('ZThing', 'zzz_custom', 'bool'),
  sig('AThing', 'aaa_custom', 'int'),
];

// Stateful harness — selection / search / expansion are parent-controlled,
// so the wrapper owns that state and forwards spies.
interface HarnessProps {
  vehicleId?: number;
  initialSelected?: string[];
  initialSearch?: string;
  initialExpanded?: string[];
  showSparklines?: boolean;
  onChange?: (next: string[]) => void;
  onSearchChange?: (next: string) => void;
  onExpandedChange?: (next: string[]) => void;
}

function Harness({
  vehicleId = 7,
  initialSelected = [],
  initialSearch = '',
  initialExpanded = [],
  showSparklines,
  onChange,
  onSearchChange,
  onExpandedChange,
}: HarnessProps) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [search, setSearch] = useState(initialSearch);
  const [expanded, setExpanded] = useState<string[]>(initialExpanded);
  const props: SignalCategoryTreeProps = {
    vehicleId,
    selectedSignals: selected,
    onChange: (next) => {
      setSelected((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        onChange?.(resolved);
        return resolved;
      });
    },
    searchValue: search,
    onSearchChange: (next) => {
      onSearchChange?.(next);
      setSearch(next);
    },
    expandedGroupIds: expanded,
    onExpandedChange: (next) => {
      onExpandedChange?.(next);
      setExpanded(next);
    },
    showSparklines,
  };
  return <SignalCategoryTree {...props} />;
}

function groupLabelsInOrder(): string[] {
  return screen
    .getAllByRole('treeitem')
    .filter((el) => el.getAttribute('aria-level') === '1')
    .map((el) => (el.getAttribute('aria-label') ?? '').replace(/,.*$/, ''));
}

function leafLabelsInOrder(): string[] {
  return screen
    .getAllByRole('treeitem')
    .filter((el) => el.getAttribute('aria-level') === '2')
    .map((el) => el.getAttribute('aria-label') ?? '');
}

beforeEach(() => {
  h.data = undefined;
  h.isLoading = false;
  h.isError = false;
  h.error = null;
});

describe('SignalCategoryTree', () => {
  it('groups the catalog and orders categories by rank then unknowns alphabetically', () => {
    h.data = { signals: SIGNALS };
    render(<Harness />);
    // Known ranks first (charging < driving < metadata), unknown ids last
    // in alpha order (aaa_custom before zzz_custom). Known ids render their
    // friendly label; unknown ids fall back to the raw id.
    expect(groupLabelsInOrder()).toEqual([
      'Charging',
      'Driving',
      'Metadata',
      'aaa_custom',
      'zzz_custom',
    ]);
    // Friendly label mapping is applied, not the raw category id.
    expect(screen.getByLabelText(/^Charging, 0 of 2 selected/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^charging,/)).not.toBeInTheDocument();
  });

  it('sorts leaves alphabetically within a category', () => {
    h.data = { signals: SIGNALS };
    render(<Harness initialExpanded={['charging']} />);
    // Only the expanded group's leaves are rendered, sorted A→Z by name.
    expect(leafLabelsInOrder()).toEqual(['ACChargingPower', 'BatteryLevel']);
  });

  it('renders the loading skeleton and no group rows while the catalog loads', () => {
    h.isLoading = true;
    render(<Harness />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
  });

  it('surfaces a load error with the interpolated backend message', () => {
    h.isError = true;
    h.error = new Error('backend exploded');
    render(<Harness />);
    expect(screen.getByText('Failed to load catalog: backend exploded')).toBeInTheDocument();
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
  });

  it('falls back to "unknown error" when the error carries no message', () => {
    h.isError = true;
    h.error = new Error('');
    render(<Harness />);
    expect(screen.getByText('Failed to load catalog: unknown error')).toBeInTheDocument();
  });

  it('shows the empty state when the catalog is present but has zero signals', () => {
    h.data = { signals: [] };
    render(<Harness />);
    expect(screen.getByText('No signals available for this vehicle.')).toBeInTheDocument();
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
  });

  it('toggling a leaf reports the new selection and reflects aria-checked', () => {
    h.data = { signals: SIGNALS };
    const onChange = vi.fn();
    render(<Harness initialExpanded={['driving']} onChange={onChange} />);
    const gear = screen.getByRole('treeitem', { name: 'Gear' });
    expect(gear).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(gear);
    expect(onChange).toHaveBeenLastCalledWith(['Gear']);
    expect(screen.getByRole('treeitem', { name: 'Gear' })).toHaveAttribute('aria-checked', 'true');
  });

  it('reflects the group tri-state count from the selection', () => {
    h.data = { signals: SIGNALS };
    render(<Harness initialSelected={['ACChargingPower']} initialExpanded={['charging']} />);
    const header = screen.getByLabelText(/^Charging, 1 of 2 selected/);
    expect(header).toHaveAttribute('aria-checked', 'mixed');
  });

  it('wires the i18n search placeholder to onSearchChange', () => {
    h.data = { signals: SIGNALS };
    const onSearchChange = vi.fn();
    render(<Harness onSearchChange={onSearchChange} />);
    const box = screen.getByPlaceholderText('Search signals…');
    fireEvent.change(box, { target: { value: 'Batt' } });
    expect(onSearchChange).toHaveBeenCalledWith('Batt');
  });

  it('expanding a collapsed group reports the change and reveals its leaves', () => {
    h.data = { signals: SIGNALS };
    const onExpandedChange = vi.fn();
    render(<Harness onExpandedChange={onExpandedChange} />);
    // Collapsed: charging leaves are hidden.
    expect(screen.queryByRole('treeitem', { name: 'ACChargingPower' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/^Charging, 0 of 2 selected/));
    expect(onExpandedChange).toHaveBeenCalledWith(['charging']);
    // Controlled state flows back in → leaves now visible.
    expect(screen.getByRole('treeitem', { name: 'ACChargingPower' })).toBeInTheDocument();
  });

  it('renders enabled sparklines for expanded leaves and threads vehicle/kind', () => {
    h.data = { signals: SIGNALS };
    render(<Harness vehicleId={42} initialExpanded={['charging']} />);
    const spark = screen.getByTestId('spark-ACChargingPower');
    expect(spark).toHaveAttribute('data-enabled', 'true');
    expect(spark).toHaveAttribute('data-vehicle', '42');
    expect(spark).toHaveAttribute('data-kind', 'float');
    // A leaf in a collapsed group is not rendered at all → no sparkline.
    expect(screen.queryByTestId('spark-Gear')).not.toBeInTheDocument();
  });

  it('enables sparklines via the search branch even when no group is expanded', () => {
    h.data = { signals: SIGNALS };
    // Search auto-shows the matching leaf; expandedSet is empty so this
    // exercises the `isSearching` operand of the enabled gate.
    render(<Harness initialSearch="AThing" initialExpanded={[]} />);
    const spark = screen.getByTestId('spark-AThing');
    expect(spark).toHaveAttribute('data-enabled', 'true');
    expect(screen.queryByTestId('spark-BatteryLevel')).not.toBeInTheDocument();
  });

  it('omits the sparkline slot entirely when showSparklines is false', () => {
    h.data = { signals: SIGNALS };
    render(<Harness initialExpanded={['charging']} showSparklines={false} />);
    // Leaves still render, but the right-slot sparkline does not.
    expect(screen.getByRole('treeitem', { name: 'ACChargingPower' })).toBeInTheDocument();
    expect(screen.queryByTestId('spark-ACChargingPower')).not.toBeInTheDocument();
  });
});
