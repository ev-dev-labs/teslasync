/**
 * DataTable accessibility contract (A11Y-10).
 *
 * Covers the four things a screen-reader user needs from a grid that
 * the base component did not previously provide: a table NAME, a
 * complete `aria-sort` state (including `none` on sortable-but-unsorted
 * columns), row-identifying checkbox labels, and spoken feedback for
 * selection and sort changes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
// Real i18n instance: the row-label and selection-count strings are
// interpolated, so the bare `t()` fallback (which returns the raw
// `{{row}}` pattern) would not exercise what a user actually hears.
import '@/i18n';
import { DataTable } from '@/components/ui/DataTable';
import {
  subscribeAnnouncer,
  __resetAnnouncerForTests,
  type AnnouncerPriority,
} from '@/hooks/useAnnouncer';
import { __resetAnnouncePolicyForTests } from '@/lib/announcePolicy';
import { __resetStatusAnnouncerForTests } from '@/hooks/useStatusAnnouncer';

interface Row {
  id: number | string;
  name: string;
  miles: number;
}

const ROWS: Row[] = [
  { id: 1, name: 'Morning commute', miles: 12 },
  { id: 2, name: 'Grocery run', miles: 4 },
  { id: 3, name: 'Airport trip', miles: 38 },
];

const COLUMNS = [
  { key: 'name', header: 'Name', render: (r: Row) => r.name, sortable: true },
  { key: 'miles', header: 'Distance', render: (r: Row) => String(r.miles) },
];

describe('DataTable accessibility', () => {
  let spoken: { message: string; priority: AnnouncerPriority }[];
  let stop: () => void;

  beforeEach(() => {
    __resetAnnouncerForTests();
    __resetAnnouncePolicyForTests();
    __resetStatusAnnouncerForTests();
    spoken = [];
    stop = subscribeAnnouncer((message, priority) => {
      spoken.push({ message: message.replace(/\u200B+$/, ''), priority });
    });
  });

  afterEach(() => {
    stop();
    __resetStatusAnnouncerForTests();
    vi.restoreAllMocks();
  });

  it('names the table from an explicit caption', () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        caption="Recent drives"
        tableId="test:drives"
      />,
    );
    expect(screen.getByRole('table', { name: 'Recent drives' })).toBeInTheDocument();
  });

  it('falls back to the boundary name, then the tableId', () => {
    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        name="Drives"
        tableId="test:drives"
      />,
    );
    expect(screen.getByRole('table', { name: 'Drives' })).toBeInTheDocument();

    rerender(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
      />,
    );
    expect(screen.getByRole('table', { name: 'test:drives' })).toBeInTheDocument();
  });

  it('marks a sortable but unsorted column aria-sort="none"', () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
        onSort={() => {}}
      />,
    );
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameHeader).toHaveAttribute('aria-sort', 'none');
  });

  it('leaves non-sortable columns without an aria-sort attribute', () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
      />,
    );
    const distanceHeader = screen.getByRole('columnheader', { name: 'Distance' });
    expect(distanceHeader).not.toHaveAttribute('aria-sort');
  });

  it('reflects the active sort direction', () => {
    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
        sortKey="name"
        sortDir="asc"
        onSort={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    rerender(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
        sortKey="name"
        sortDir="desc"
        onSort={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('derives a row-identifying checkbox label from the first column', () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={() => {}}
      />,
    );
    const table = screen.getByRole('table');
    // Every row checkbox is distinguishable — no repeated "Select row".
    expect(
      within(table).getByRole('checkbox', { name: /Morning commute/ }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('checkbox', { name: /Airport trip/ }),
    ).toBeInTheDocument();
  });

  it('digs the label out of a JSX cell renderer, not just a bare string', () => {
    // Regression guard: virtually every real renderer wraps its value in
    // a <span>/badge/flex row, so a `typeof rendered === 'string'` check
    // matched almost nothing and every table silently fell back to the
    // generic wording.
    const wrappedColumns = [
      {
        key: 'name',
        header: 'Name',
        render: (r: Row) => (
          <div className="flex items-center gap-2">
            <svg aria-hidden="true" />
            <span className="font-medium">{r.name}</span>
          </div>
        ),
      },
    ];
    render(
      <DataTable
        columns={wrappedColumns}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:wrapped"
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('checkbox', { name: /Grocery run/ }),
    ).toBeInTheDocument();
  });

  it('never names a checkbox after an opaque UUID key', () => {
    // A screen reader spells a UUID out character by character, which is
    // materially worse than the generic wording it would replace.
    const uuidRows = [
      { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', name: '', miles: 0 },
      { id: '9c858901-8a57-4791-81fe-4c455b099bc9', name: '', miles: 0 },
    ];
    const opaqueColumns = [
      { key: 'badge', header: 'Status', render: () => <span aria-hidden="true">•</span> },
    ];
    render(
      <DataTable
        columns={opaqueColumns}
        data={uuidRows}
        keyExtractor={(r) => r.id}
        tableId="test:uuid"
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(2);
    expect(screen.queryByRole('checkbox', { name: /f47ac10b/ })).toBeNull();
  });

  it('prefers an explicit rowLabel over the derived one', () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={() => {}}
        rowLabel={(r) => `Drive ${r.id}`}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /Drive 1/ })).toBeInTheDocument();
  });

  it('falls back to generic wording when no label can be derived', () => {
    // Nothing readable anywhere: the only cell is decorative, and the row
    // keys are bare numeric primary keys ("Select 4291" is noise).
    const opaqueColumns = [
      {
        key: 'badge',
        header: 'Status',
        render: () => <span aria-hidden="true">●</span>,
      },
    ];
    render(
      <DataTable
        columns={opaqueColumns}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:opaque"
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('checkbox', { name: 'Select row' })).toHaveLength(3);
  });

  it('announces the new selection count when a row is toggled', () => {
    render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
        selectable="multi"
        selectedKeys={[]}
        onSelectionChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Morning commute/ }));
    expect(spoken.length).toBeGreaterThan(0);
    expect(spoken[0].priority).toBe('polite');
  });

  it('announces a sort change but stays silent for a pre-sorted mount', () => {
    const { rerender } = render(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
        sortKey="name"
        sortDir="asc"
        onSort={() => {}}
      />,
    );
    expect(spoken).toHaveLength(0);

    rerender(
      <DataTable
        columns={COLUMNS}
        data={ROWS}
        keyExtractor={(r) => r.id}
        tableId="test:drives"
        sortKey="name"
        sortDir="desc"
        onSort={() => {}}
      />,
    );
    expect(spoken).toHaveLength(1);
    expect(spoken[0].priority).toBe('polite');
  });
});
