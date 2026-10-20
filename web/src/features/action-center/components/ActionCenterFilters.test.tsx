import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ActionCenterFilter } from '@/types/actionCenter';
import { ActionCenterFilters } from './ActionCenterFilters';

const vehicles = [
  { id: 7, display_name: 'Orion' },
  { id: 19, display_name: 'Fleet vehicle with a long display name' },
];
const filter: ActionCenterFilter = {
  vehicle_id: 7,
  priority: 'high',
  source_feature: 'battery_health',
  state: 'snoozed',
  limit: 25,
  offset: 75,
};
const optionGroups = [
  {
    label: 'Vehicle',
    field: 'vehicle_id',
    options: [
      ['', 'All vehicles'],
      ['7', 'Orion'],
      ['19', 'Fleet vehicle with a long display name'],
    ],
  },
  {
    label: 'Priority',
    field: 'priority',
    options: [
      ['', 'All priorities'],
      ['critical', 'Critical'],
      ['high', 'High'],
      ['medium', 'Medium'],
      ['low', 'Low'],
    ],
  },
  {
    label: 'Source',
    field: 'source_feature',
    options: [
      ['', 'All sources'],
      ['active_alerts', 'Active alerts'],
      ['advanced_intelligence', 'Advanced intelligence'],
      ['battery_health', 'Battery health'],
      ['charging_reliability', 'Charging reliability'],
      ['drive_efficiency', 'Drive efficiency'],
      ['fleet_maintenance', 'Fleet maintenance'],
      ['signal_health', 'Signal health'],
      ['system_health', 'System health'],
      ['vehicle_readiness', 'Vehicle readiness'],
    ],
  },
  {
    label: 'State',
    field: 'state',
    options: [
      ['', 'All states'],
      ['open', 'Open'],
      ['acknowledged', 'Acknowledged'],
      ['snoozed', 'Snoozed'],
      ['dismissed', 'Dismissed'],
    ],
  },
] as const;

describe('ActionCenterFilters', () => {
  it('keeps clear label wrapping with mobile minimum and compact desktop classes', () => {
    render(<ActionCenterFilters filter={filter} vehicles={vehicles} onChange={vi.fn()} />);

    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear).toHaveAttribute('type', 'button');
    expect(clear).toHaveClass(
      'h-auto', 'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0',
      'max-w-full', 'whitespace-normal', 'px-3',
    );
    expect(clear).not.toHaveClass('h-9');
    expect(clear.firstElementChild).toHaveClass('min-w-0', 'break-words');
    expect(clear.parentElement).toHaveClass('flex', 'flex-wrap', 'gap-3');
    expect(screen.getByRole('heading', { name: 'Filter decisions' })).toBeVisible();
  });

  it('preserves every labeled fleet priority source and state option and selection', () => {
    const onChange = vi.fn();
    render(<ActionCenterFilters filter={filter} vehicles={vehicles} onChange={onChange} />);

    expect(screen.getAllByRole('combobox')).toHaveLength(4);
    for (const group of optionGroups) {
      const select = screen.getByRole('combobox', { name: group.label });
      expect(within(select).getAllByRole('option').map((option) => [
        (option as HTMLOptionElement).value,
        option.textContent,
      ])).toEqual(group.options);
      expect(select).toHaveValue(String(filter[group.field]));
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(optionGroups)('changes every $label option without losing unrelated filters', (group) => {
    const onChange = vi.fn();
    render(<ActionCenterFilters filter={filter} vehicles={vehicles} onChange={onChange} />);

    const select = screen.getByRole('combobox', { name: group.label });
    for (const [value] of group.options) {
      fireEvent.change(select, { target: { value } });
      expect(onChange).toHaveBeenLastCalledWith({
        ...filter,
        [group.field]: value === '' ? undefined : group.field === 'vehicle_id' ? Number(value) : value,
        offset: 0,
      });
    }
    expect(onChange).toHaveBeenCalledTimes(group.options.length);
    expect(filter.offset).toBe(75);
  });

  it.each([
    { case: 'configured limit', limit: 25, expectedLimit: 25 },
    { case: 'missing limit', limit: undefined, expectedLimit: 50 },
    { case: 'zero limit', limit: 0, expectedLimit: 0 },
  ])('clears all filters and resets open pagination with $case', async ({ limit, expectedLimit }) => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ActionCenterFilters filter={{ ...filter, limit }} vehicles={vehicles} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      state: 'open',
      limit: expectedLimit,
      offset: 0,
    });
  });

  it('retains the fleet-local selector and all other filters with no vehicles', () => {
    const onChange = vi.fn();
    render(<ActionCenterFilters filter={{}} vehicles={[]} onChange={onChange} />);

    const vehicle = screen.getByRole('combobox', { name: 'Vehicle' });
    expect(within(vehicle).getAllByRole('option')).toHaveLength(1);
    expect(within(vehicle).getByRole('option', { name: 'All vehicles' })).toHaveValue('');
    for (const group of optionGroups) {
      expect(screen.getByRole('combobox', { name: group.label })).toHaveValue('');
    }
    expect(screen.getAllByRole('combobox')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeEnabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
