import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import '@/i18n';
import { DataTableValueFilter, type TableFilterValue } from './DataTableValueFilter';

const options: TableFilterValue[] = [
  { value: 'home', label: 'Home', count: 3 },
  { value: 'office', label: 'Office', count: 2 },
  { value: 'unknown', label: '(Not recorded)', count: 1 },
];

function Filter({ initial = null, values = options }: { initial?: string[] | null; values?: TableFilterValue[] }) {
  const [selected, setSelected] = useState(initial);
  return <DataTableValueFilter options={values} selected={selected} onChange={setSelected} />;
}

describe('DataTableValueFilter', () => {
  it('shows values, counts, and a mixed-state Select all', () => {
    render(<Filter />);
    expect(screen.getByRole('checkbox', { name: 'Select all shown values' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Home' }).closest('label')).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Office' }));
    expect(screen.getByRole('checkbox', { name: 'Select all shown values' })).toBePartiallyChecked();
    expect(screen.getByText('2 of 3 loaded values selected')).toBeInTheDocument();
  });

  it('keeps none distinct from all and can recover', () => {
    render(<Filter />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown values' }));
    expect(screen.getByText('0 of 3 loaded values selected')).toBeInTheDocument();
    for (const option of options) expect(screen.getByRole('checkbox', { name: option.label })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown values' }));
    expect(screen.getByText('3 of 3 loaded values selected')).toBeInTheDocument();
  });

  it('searches case-insensitively and toggles only the shown values', () => {
    render(<Filter />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search values' }), { target: { value: ' OFF ' } });
    const values = screen.getByRole('group', { name: 'Available values' });
    expect(within(values).getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all shown values' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(screen.getByRole('checkbox', { name: 'Office' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Home' })).toBeChecked();
  });

  it('provides a clear-search action when nothing matches', () => {
    render(<Filter />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'missing' } });
    expect(screen.getByText('No matching values')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all shown values' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('checkbox', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search values' })).toHaveFocus();
  });

  it('groups display-equivalent raw keys and supports their partial selection', () => {
    render(<Filter initial={['40001']} values={[{ value: 'distance', label: '40.00 km', count: 2, keys: ['40001', '40002'] }]} />);
    expect(screen.getByRole('checkbox', { name: '40.00 km' })).toBePartiallyChecked();
    expect(screen.getByRole('checkbox', { name: 'Select all shown values' })).toBePartiallyChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '40.00 km' }));
    expect(screen.getByRole('checkbox', { name: '40.00 km' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '40.00 km' }));
    expect(screen.getByRole('checkbox', { name: '40.00 km' })).not.toBeChecked();
  });

  it('discloses unavailable saved selections rather than silently selecting all', () => {
    render(<Filter initial={['missing']} />);
    expect(screen.getByText(/Some saved selections are not present/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select all shown values' })).not.toBeChecked();
  });

  it('shows an explicit invalid-filter error', () => {
    render(<DataTableValueFilter options={options} selected={null} onChange={() => undefined} invalid />);
    expect(screen.getByText('This saved value filter is invalid. Clear it to reset.')).toBeInTheDocument();
  });
});
