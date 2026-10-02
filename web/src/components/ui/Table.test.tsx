import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Table } from './Table';
import { Button } from './Button';

describe('Table', () => {
  it('renders a semantic table and forwards attributes, classes, and refs', () => {
    const ref = createRef<HTMLTableElement>();

    render(
      <Table
        ref={ref}
        aria-label="Scheduled exports"
        className="text-xs"
        data-testid="table"
      >
        <tbody>
          <tr>
            <td>Weekly drives</td>
          </tr>
        </tbody>
      </Table>,
    );

    const table = screen.getByRole('table', { name: 'Scheduled exports' });
    expect(table).toBe(screen.getByTestId('table'));
    expect(table).toHaveClass('w-full', 'border-collapse', 'text-xs');
    expect(table).toHaveTextContent('Weekly drives');
    expect(ref.current).toBe(table);
    expect(table.parentElement).toHaveClass('min-w-0', 'max-w-full', 'overflow-x-auto');
    expect(table.parentElement?.parentElement).toHaveClass('rounded-xl', 'p-3', 'bg-[var(--surface-1)]');
    expect(table).toHaveClass('[&_th]:normal-case', '[&_th]:tracking-normal');
  });

  it('preserves embedded matrix actions instead of synthesizing grid interactivity', () => {
    const onAction = vi.fn();
    render(<Table><caption>Fleet matrix</caption><tbody><tr>
      <th scope="row">FSD</th><td><Button onClick={onAction}>View details</Button></td>
    </tr></tbody></Table>);
    fireEvent.click(screen.getByRole('button', { name: 'View details' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.getByRole('rowheader', { name: 'FSD' })).toHaveTextContent('FSD');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('preserves captions, multi-level headings, spans, and caller-owned matrix styling', () => {
    render(
      <Table className="[&_td]:p-0" aria-describedby="matrix-note">
        <caption>Battery matrix</caption>
        <thead><tr><th rowSpan={2} scope="col">Pack</th><th colSpan={2} scope="colgroup">Cells</th></tr>
          <tr><th scope="col">Min</th><th scope="col">Max</th></tr></thead>
        <tbody><tr><th scope="row">A</th><td>3.6</td><td>3.8</td></tr></tbody>
        <tfoot><tr><td colSpan={3} id="matrix-note">Recorded readings</td></tr></tfoot>
      </Table>,
    );
    const table = screen.getByRole('table', { name: 'Battery matrix' });
    expect(table).toHaveAttribute('aria-describedby', 'matrix-note');
    expect(table).toHaveClass('[&_td]:p-0');
    expect(screen.getByRole('columnheader', { name: 'Cells' })).toHaveAttribute('colspan', '2');
    expect(screen.getByRole('rowheader', { name: 'A' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
