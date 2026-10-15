import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FsdTopDays } from './FsdTopDays';
import { fsdDay, fsdInsights } from './__tests__/fixtures';

const { translations } = vi.hoisted(() => ({
  translations: {} as Record<string, string>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        translations[key] ?? fallback,
      ),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { locale: 'en-US' },
    formatDistance: (meters: number) => `${meters / 1000} km`,
  }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number) => String(value),
    fmtInt: (value: number) => String(value),
  }),
}));

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver,
  )));
}
const state = { isLoading: false, error: null, onRetry: vi.fn(), noVehicle: false };
const insights = fsdInsights({
  daily: [
    fsdDay({ date: '2026-03-02', fsd_distance_m: 8000, driving_distance_m: 16000, fsd_share_pct: 50, reset_count: 2 }),
    fsdDay({ date: '2026-03-01', fsd_distance_m: 4000 }),
    fsdDay({ date: '2026-02-28', fsd_distance_m: 0 }),
  ],
});

beforeEach(() => {
  for (const key of Object.keys(translations)) delete translations[key];
  localStorage.clear();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('FsdTopDays mobile full details', () => {
  it('retains all five fields, ranked days and keyboard details across mobile and desktop', async () => {
    const user = userEvent.setup();
    const view = render(<FsdTopDays insights={insights} state={state} />);
    resize(375);
    expect(view.container.querySelector('table')).toBeNull();
    expect(view.container.querySelector('[data-mobile-table]')).not.toBeNull();
    expect(screen.queryByText('Saturday, February 28, 2026')).not.toBeInTheDocument();
    expect(screen.getAllByText('8 km')[0]).toBeInTheDocument();
    const quickView = screen.getAllByRole('button', { name: 'Quick view' })[0];
    expect(quickView).toHaveClass('min-h-11', 'min-w-11');
    quickView.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    for (const field of ['Local day', 'Self-driving', 'Observed driving', 'Share', 'Flags']) {
      expect(within(dialog).getByText(field)).toBeInTheDocument();
    }
    for (const value of ['8 km', '16 km', '50%', 'Counter reset (2)']) {
      expect(within(dialog).getByText(value)).toBeInTheDocument();
    }
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(quickView).toHaveFocus();
    await user.click(screen.getAllByRole('button', { name: 'Quick view' })[1]);
    expect(within(screen.getByRole('dialog')).getAllByText('Not reported')).toHaveLength(2);
    expect(within(screen.getByRole('dialog')).getByText('None')).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close', exact: true }).at(-1)!);
    resize(1280);
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
    const table = screen.getByRole('table', { name: 'Most active days' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(5);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByTestId('fsd-top-days')).toBeInTheDocument();
  });

  it('uses the localized panel title as the populated table caption, not its internal identity', () => {
    translations['fsd.topDays.title'] = 'Jours les plus actifs';
    render(<FsdTopDays insights={insights} state={state} />);
    resize(1280);

    const table = screen.getByRole('table', { name: 'Jours les plus actifs' });
    expect(table.querySelector('caption')).toHaveTextContent('Jours les plus actifs');
    expect(screen.getByRole('heading', { name: 'Jours les plus actifs' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'FsdTopDays' })).not.toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('keeps the panel and honest empty state when no active distance was reported', () => {
    render(<FsdTopDays insights={fsdInsights({ daily: [] })} state={state} />);
    expect(screen.getByTestId('fsd-top-days')).toBeInTheDocument();
    expect(screen.getByText('No day in this period accumulated supervised self-driving distance.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
