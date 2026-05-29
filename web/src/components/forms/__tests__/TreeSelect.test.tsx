/**
 * TreeSelect — unit tests.
 *
 * Covers: leaf toggle, group tri-state, search filtering + select-visible,
 * disabled leaves, top-level select-all/clear, sparkline render slot,
 * keyboard navigation (Arrow / Space / Enter), aria-checked="mixed",
 * empty + no-results states.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { TreeSelect, type TreeGroup } from '../TreeSelect';

interface SignalLeafData {
  unit: string;
}

const GROUPS: TreeGroup<SignalLeafData>[] = [
  {
    id: 'charging',
    label: 'Charging',
    leaves: [
      { id: 'ACChargingPower', label: 'ACChargingPower', data: { unit: 'kW' } },
      { id: 'BatteryLevel', label: 'BatteryLevel', data: { unit: '%' } },
      { id: 'ChargingState', label: 'ChargingState', data: { unit: 'enum' } },
    ],
  },
  {
    id: 'driving',
    label: 'Driving',
    leaves: [
      { id: 'Speed', label: 'Speed', data: { unit: 'mph' } },
      { id: 'Gear', label: 'Gear', data: { unit: 'enum' } },
    ],
  },
  {
    id: 'climate',
    label: 'Climate',
    leaves: [
      { id: 'InsideTemp', label: 'InsideTemp', data: { unit: '°C' } },
    ],
  },
];

interface HarnessProps {
  initialSelected?: string[];
  initialSearch?: string;
  initialExpanded?: string[];
  onChange?: (next: string[]) => void;
  getLeafDisabled?: (leaf: { id: string }) => boolean;
  groups?: TreeGroup<SignalLeafData>[];
  isLoading?: boolean;
  renderLeafRight?: (leaf: { id: string; label: string }) => React.ReactNode;
}

function Harness({
  initialSelected = [],
  initialSearch = '',
  initialExpanded = ['charging', 'driving', 'climate'],
  onChange,
  getLeafDisabled,
  groups = GROUPS,
  isLoading,
  renderLeafRight,
}: HarnessProps) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [search, setSearch] = useState(initialSearch);
  const [expanded, setExpanded] = useState<string[]>(initialExpanded);
  return (
    <TreeSelect<SignalLeafData>
      groups={groups}
      selectedIds={selected}
      onChange={(next) => {
        setSelected((prev) => {
          const resolved = typeof next === 'function' ? next(prev) : next;
          onChange?.(resolved);
          return resolved;
        });
      }}
      searchValue={search}
      onSearchChange={setSearch}
      expandedGroupIds={expanded}
      onExpandedChange={setExpanded}
      getLeafDisabled={getLeafDisabled}
      isLoading={isLoading}
      renderLeafRight={renderLeafRight}
    />
  );
}

describe('TreeSelect', () => {
  it('renders all groups and their leaves when expanded', () => {
    render(<Harness />);
    // 3 groups
    expect(screen.getByLabelText(/Charging, 0 of 3 selected/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Driving, 0 of 2 selected/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Climate, 0 of 1 selected/)).toBeInTheDocument();
    // Sample leaves
    expect(screen.getByRole('treeitem', { name: 'Speed' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'BatteryLevel' })).toBeInTheDocument();
  });

  it('toggling a leaf calls onChange with the new selection', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('treeitem', { name: 'Speed' }));
    expect(onChange).toHaveBeenLastCalledWith(['Speed']);
  });

  it('group checkbox is indeterminate when some leaves selected', () => {
    render(<Harness initialSelected={['Speed']} />);
    const drivingHeader = screen.getByLabelText(/Driving, 1 of 2 selected/);
    expect(drivingHeader).toHaveAttribute('aria-checked', 'mixed');
  });

  it('group checkbox is checked when all leaves selected', () => {
    render(<Harness initialSelected={['Speed', 'Gear']} />);
    const drivingHeader = screen.getByLabelText(/Driving, 2 of 2 selected/);
    expect(drivingHeader).toHaveAttribute('aria-checked', 'true');
  });

  it('toggling group selects all its (visible, enabled) leaves', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const drivingCheckbox = within(
      screen.getByLabelText(/Driving, 0 of 2 selected/),
    ).getByLabelText('Toggle Driving');
    fireEvent.click(drivingCheckbox);
    const calledWith = onChange.mock.calls[0][0] as string[];
    expect(calledWith.sort()).toEqual(['Gear', 'Speed']);
  });

  it('top-level "Select all" selects every visible enabled leaf', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Select all/i));
    const calledWith = onChange.mock.calls[0][0] as string[];
    expect(calledWith.sort()).toEqual([
      'ACChargingPower',
      'BatteryLevel',
      'ChargingState',
      'Gear',
      'InsideTemp',
      'Speed',
    ]);
  });

  it('top-level checkbox flips to "Clear all" once everything selected', () => {
    render(
      <Harness
        initialSelected={[
          'ACChargingPower',
          'BatteryLevel',
          'ChargingState',
          'Speed',
          'Gear',
          'InsideTemp',
        ]}
      />,
    );
    expect(screen.getByLabelText(/Clear all/i)).toBeInTheDocument();
  });

  it('search filters leaves and groups; group-toggle then affects only visible', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initialSearch="Speed" />);
    // Charging + Climate filtered out (zero matching leaves)
    expect(screen.queryByLabelText(/Charging, /)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Climate, /)).not.toBeInTheDocument();
    // Driving group remains; the group's visible-leaf count becomes 1.
    const drivingHeader = screen.getByLabelText(/Driving, 0 of 1 selected/);
    expect(drivingHeader).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Speed' })).toBeInTheDocument();
    expect(screen.queryByRole('treeitem', { name: 'Gear' })).not.toBeInTheDocument();
    // Toggle the Driving group while filtered → only Speed gets selected
    const drivingCheckbox = within(drivingHeader).getByLabelText('Toggle Driving');
    fireEvent.click(drivingCheckbox);
    expect(onChange).toHaveBeenLastCalledWith(['Speed']);
  });

  it('search "Select N visible" label shows the visible count', () => {
    render(<Harness initialSearch="Charging" />);
    // "ACChargingPower" + "ChargingState" + group label match → 3 visible leaves
    expect(screen.getByText(/Select 3 visible/)).toBeInTheDocument();
  });

  it('selection is preserved when search filters out the selected leaf', () => {
    const onChange = vi.fn();
    render(<Harness initialSelected={['Gear']} initialSearch="Speed" onChange={onChange} />);
    // Gear is hidden by search, but selection stays in the count.
    // Text is split across nodes ("1 selected" + " of 6"); use a flexible matcher.
    expect(
      screen.getByText((_, node) =>
        node?.textContent === '1 selected of 6',
      ),
    ).toBeInTheDocument();
  });

  it('disabled leaf is uncheckable by click and excluded from group toggle', () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        getLeafDisabled={(l) => l.id === 'Gear'}
      />,
    );
    // Click Gear → no change
    fireEvent.click(screen.getByRole('treeitem', { name: 'Gear' }));
    expect(onChange).not.toHaveBeenCalled();
    // Toggle Driving group → only Speed gets selected (not disabled Gear)
    const drivingCheckbox = within(
      screen.getByLabelText(/Driving, 0 of 2 selected/),
    ).getByLabelText('Toggle Driving');
    fireEvent.click(drivingCheckbox);
    expect(onChange).toHaveBeenLastCalledWith(['Speed']);
  });

  it('renders "no results" message when search has zero matches', () => {
    render(<Harness initialSearch="zzz-no-match" />);
    expect(screen.getByText(/No matches for "zzz-no-match"/)).toBeInTheDocument();
  });

  it('renders empty state when groups list is empty', () => {
    render(<Harness groups={[]} />);
    expect(screen.getByText(/No items available/)).toBeInTheDocument();
  });

  it('renders loading skeleton when isLoading=true', () => {
    render(<Harness isLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('calls renderLeafRight for each visible leaf', () => {
    const renderLeafRight = vi.fn().mockImplementation((leaf: { id: string }) => (
      <span data-testid={`right-${leaf.id}`}>★</span>
    ));
    render(<Harness renderLeafRight={renderLeafRight} />);
    expect(screen.getByTestId('right-Speed')).toBeInTheDocument();
    expect(screen.getByTestId('right-BatteryLevel')).toBeInTheDocument();
    // 6 leaves total
    expect(renderLeafRight).toHaveBeenCalledTimes(6);
  });

  it('"Clear all selected" link wipes the selection', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} initialSelected={['Speed', 'Gear']} />);
    fireEvent.click(screen.getByRole('button', { name: /Clear all selected/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('Space key toggles a focused leaf checkbox', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const tree = screen.getByRole('tree');
    // Default focusIndex is 0 (the first group "Charging"). Move down 1 → first leaf.
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: ' ' });
    expect(onChange).toHaveBeenLastCalledWith(['ACChargingPower']);
  });

  it('Space key on focused group toggles all visible leaves in that group', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const tree = screen.getByRole('tree');
    // FocusIndex = 0 → first group "Charging".
    fireEvent.keyDown(tree, { key: ' ' });
    const calledWith = onChange.mock.calls[0][0] as string[];
    expect(calledWith.sort()).toEqual(['ACChargingPower', 'BatteryLevel', 'ChargingState']);
  });

  it('ArrowRight expands a collapsed group; ArrowLeft collapses it', () => {
    function Wrapper() {
      const [selected, setSelected] = useState<string[]>([]);
      const [search, setSearch] = useState('');
      const [expanded, setExpanded] = useState<string[]>([]); // start collapsed
      return (
        <TreeSelect
          groups={GROUPS}
          selectedIds={selected}
          onChange={setSelected}
          searchValue={search}
          onSearchChange={setSearch}
          expandedGroupIds={expanded}
          onExpandedChange={setExpanded}
        />
      );
    }
    render(<Wrapper />);
    // Initially collapsed: no leaves visible.
    expect(screen.queryByRole('treeitem', { name: 'Speed' })).not.toBeInTheDocument();
    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowRight' }); // expand "Charging"
    expect(screen.getByRole('treeitem', { name: 'BatteryLevel' })).toBeInTheDocument();
    fireEvent.keyDown(tree, { key: 'ArrowLeft' }); // collapse it
    expect(screen.queryByRole('treeitem', { name: 'BatteryLevel' })).not.toBeInTheDocument();
  });

  // ── Regression tests for the "checkbox doesn't work" UX bug ───
  // clicking on the visual checkbox inside a leaf row
  // previously fired the leaf checkbox's `onChange` AND bubbled to the
  // row's `onClick`, producing two toggles per click that cancelled
  // each other. Fix: the leaf checkbox is now wrapped with
  // `pointer-events-none` so all clicks land on the row exactly once.
  it('clicking the visual checkbox area on a leaf toggles exactly once', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const speedRow = screen.getByRole('treeitem', { name: 'Speed' });
    // The decorative checkbox sits inside the row. A click in jsdom
    // bubbles up the DOM, so simulate a click on the inner checkbox
    // input — the row should still see exactly one toggle, not two.
    const innerCheckbox = speedRow.querySelector('input[type="checkbox"]');
    expect(innerCheckbox).not.toBeNull();
    fireEvent.click(innerCheckbox as HTMLElement);
    // After exactly one toggle, Speed should be selected.
    expect(onChange).toHaveBeenLastCalledWith(['Speed']);
    // And the row's aria-checked reflects the new state.
    expect(speedRow).toHaveAttribute('aria-checked', 'true');
  });

  it('rapid successive toggles in one render cycle accumulate (no stale closure)', () => {
    // Build a TreeSelect where the parent is naive: the harness keeps
    // state in useState, so two synchronous fireEvent.click calls on
    // separate leaves dispatch with the SAME `selectedIds` snapshot.
    // Without the functional-setter API, the second toggle would
    // overwrite the first. We assert both selections survive.
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('treeitem', { name: 'Speed' }));
    fireEvent.click(screen.getByRole('treeitem', { name: 'Gear' }));
    // Last call to the spy should reflect both selections, in order.
    expect(onChange).toHaveBeenLastCalledWith(['Speed', 'Gear']);
  });
});
