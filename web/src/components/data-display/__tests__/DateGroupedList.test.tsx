import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DateGroupedList, type DateGroupedListGroup } from '../DateGroupedList';

interface Item {
  id: number;
  label: string;
}

function groups(): DateGroupedListGroup<Item>[] {
  return [
    {
      dateKey: '2026-05-09',
      dateLabel: 'May 9, 2026',
      relativeLabel: '3 days ago',
      summary: '2 drives · 6.2 mi',
      items: [
        { id: 1, label: 'Drive 1' },
        { id: 2, label: 'Drive 2' },
      ],
    },
    {
      dateKey: '2026-04-24',
      dateLabel: 'Apr 24, 2026',
      relativeLabel: '18 days ago',
      summary: '2 drives · 39.9 mi',
      items: [
        { id: 3, label: 'Drive 3' },
        { id: 4, label: 'Drive 4' },
      ],
    },
  ];
}

describe('DateGroupedList', () => {
  it('renders one section per group with a labelled header', () => {
    render(
      <DateGroupedList
        groups={groups()}
        renderItem={(item) => <span data-testid={`item-${item.id}`}>{item.label}</span>}
        itemKey={(item) => item.id}
      />,
    );
    expect(screen.getByText('May 9, 2026')).toBeInTheDocument();
    expect(screen.getByText('Apr 24, 2026')).toBeInTheDocument();
  });

  it('renders relative label when provided', () => {
    render(
      <DateGroupedList
        groups={groups()}
        renderItem={(i) => <span>{i.label}</span>}
        itemKey={(i) => i.id}
      />,
    );
    expect(screen.getByText(/3 days ago/i)).toBeInTheDocument();
    expect(screen.getByText(/18 days ago/i)).toBeInTheDocument();
  });

  it('renders summary text per group', () => {
    render(
      <DateGroupedList
        groups={groups()}
        renderItem={(i) => <span>{i.label}</span>}
        itemKey={(i) => i.id}
      />,
    );
    expect(screen.getByText(/2 drives · 6.2 mi/i)).toBeInTheDocument();
    expect(screen.getByText(/2 drives · 39.9 mi/i)).toBeInTheDocument();
  });

  it('invokes renderItem for each item, in order', () => {
    render(
      <DateGroupedList
        groups={groups()}
        renderItem={(item) => <span data-testid={`item-${item.id}`}>{item.label}</span>}
        itemKey={(item) => item.id}
      />,
    );
    expect(screen.getByTestId('item-1')).toBeInTheDocument();
    expect(screen.getByTestId('item-2')).toBeInTheDocument();
    expect(screen.getByTestId('item-3')).toBeInTheDocument();
    expect(screen.getByTestId('item-4')).toBeInTheDocument();
  });

  it('emits sections with data-date-key for tooling', () => {
    const { container } = render(
      <DateGroupedList
        groups={groups()}
        renderItem={(i) => <span>{i.label}</span>}
        itemKey={(i) => i.id}
      />,
    );
    expect(container.querySelectorAll('[data-date-key]')).toHaveLength(2);
  });

  it('renders empty container for empty groups', () => {
    render(
      <DateGroupedList
        groups={[]}
        renderItem={(i: Item) => <span>{i.label}</span>}
        testId="grouped-empty"
      />,
    );
    expect(screen.getByTestId('grouped-empty')).toBeEmptyDOMElement();
  });
});
