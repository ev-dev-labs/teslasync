import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { Table } from './Table';

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
  });
});
