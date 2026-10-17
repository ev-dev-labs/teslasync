import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fmtNumber } from '@/lib/numberFormat';
import { analyzeSleepEfficiency } from '../../lib/sleepEfficiencyAnalysis';
import { sleepEfficiencyFixture } from '../sleep-efficiency-modernization/sleepEfficiency.fixture';
import { RangeSourceCoverage } from './RangeSourceCoverage';
import type { SleepEfficiencyQueryState } from './types';

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
const categories = [
  'Included', 'Missing state', 'Invalid count', 'Invalid minutes', 'Duplicate state',
  'Included', 'Invalid timestamp', 'Future event', 'Invalid duration',
  'Invalid battery fields', 'Duplicate event ID',
];
const counts = [1234, 0, 2, 3, 4, 5678, 6, 7, 8, 9, 10];
const state: SleepEfficiencyQueryState = {
  vehicleSelected: true, isLoading: false, isResolved: true,
  error: null, refreshError: null, onRetry: vi.fn(),
};

function mount(width: number) {
  const base = analyzeSleepEfficiency(
    sleepEfficiencyFixture(), Date.parse('2026-08-07T12:00:00Z'),
    '2026-08-04', '2026-08-06',
  );
  const analysis = {
    ...base,
    stateAccounting: {
      ...base.stateAccounting,
      categories: {
        included: counts[0], missing_state: counts[1], invalid_count: counts[2],
        invalid_minutes: counts[3], duplicate_state: counts[4],
      },
    },
    events: {
      ...base.events,
      accounting: {
        ...base.events.accounting,
        categories: {
          included: counts[5], invalid_timestamp: counts[6], future: counts[7],
          invalid_duration: counts[8], invalid_battery: counts[9], duplicate_id: counts[10],
        },
      },
    },
  };
  const view = render(<RangeSourceCoverage analysis={analysis} state={state} />);
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver,
  )));
  return view;
}

beforeEach(() => {
  localStorage.clear();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-mode');
});

describe('RangeSourceCoverage responsive accounting', () => {
  it.each(['light', 'dark'])('preserves eleven desktop rows and formatted counts in %s mode', mode => {
    document.documentElement.setAttribute('data-mode', mode);
    mount(1200);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(11);
    rows.forEach((row, index) => {
      expect(row).toHaveTextContent(index < 5 ? 'State rows' : 'Event rows');
      expect(row).toHaveTextContent(categories[index]);
      expect(row).toHaveTextContent(fmtNumber(counts[index], 0));
    });
  });

  it.each(['light', 'dark'])('makes source, category and count accessible on mobile in %s mode', async mode => {
    document.documentElement.setAttribute('data-mode', mode);
    const user = userEvent.setup();
    const view = mount(375);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = Array.from(view.container.querySelectorAll('[data-card]'));
    expect(cards).toHaveLength(11);
    cards.forEach((card, index) => {
      expect(card.querySelector('[data-card-label]')).toHaveTextContent(index < 5 ? 'State rows' : 'Event rows');
      expect(card.querySelector('[data-card-meta]')).toHaveTextContent(categories[index]);
      expect(card.querySelector('[data-card-primary]')).toHaveTextContent(fmtNumber(counts[index], 0));
    });
    for (const [index, card] of cards.entries()) {
      (card as HTMLElement).focus();
      await user.keyboard(index % 2 === 0 ? '{Enter}' : ' ');
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAccessibleName(`${index < 5 ? 'State rows' : 'Event rows'}: ${categories[index]}`);
      expect(within(dialog).getByText('Source')).toBeInTheDocument();
      expect(within(dialog).getByText('Mutually exclusive category')).toBeInTheDocument();
      expect(within(dialog).getByText('Rows', { exact: true })).toBeInTheDocument();
      expect(within(dialog).getByText(fmtNumber(counts[index], 0), { exact: true })).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(card).toHaveFocus();
    }
    await user.click(screen.getAllByRole('button', { name: 'Quick view' })[0]);
    const quickDialog = screen.getByRole('dialog');
    expect(quickDialog).toBeInTheDocument();
    const quickFooter = quickDialog.querySelector('[data-modal-footer]');
    if (!(quickFooter instanceof HTMLElement)) throw new Error('Missing quick-view dialog footer');
    await user.click(within(quickFooter).getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
