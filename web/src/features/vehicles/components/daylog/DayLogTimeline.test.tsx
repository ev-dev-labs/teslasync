import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DayLogEvent } from '@/api/types';
import { DayLogTimeline, type DayLogTimelineProps } from './DayLogTimeline';

const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  timezone: 'America/New_York',
  translations: {} as Record<string, string>,
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
      locale: preferences.locale, timezone_user: preferences.timezone,
      decimal_precision: 2,
    },
    locale: preferences.locale,
    decimals: 2,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string, variables?: Record<string, unknown>) =>
      (preferences.translations[key] ?? fallback ?? key).replace(
        /{{\s*(\w+)\s*}}/g,
        (match, name: string) => String(variables?.[name] ?? match),
      ),
  }),
}));

// Supply jsdom scroll geometry, but retain TanStack's real windowing and measurement lifecycle.
vi.mock('@tanstack/react-virtual', async (importActual) => {
  const actual = await importActual<typeof import('@tanstack/react-virtual')>();
  return {
    ...actual,
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer<HTMLDivElement, Element>>[0]) =>
      actual.useVirtualizer<HTMLDivElement, Element>({
        ...options,
        initialRect: { width: 320, height: 128 },
        observeElementRect: (_instance, callback) => {
          callback({ width: 320, height: 128 });
          return () => {};
        },
        observeElementOffset: (instance, callback) => {
          const element = instance.scrollElement;
          if (!element) return () => {};
          Object.defineProperty(element, 'scrollHeight', {
            configurable: true,
            get: () => instance.getTotalSize(),
          });
          Object.defineProperty(element, 'clientHeight', { configurable: true, value: 128 });
          const notify = () => callback(element.scrollTop, false);
          element.addEventListener('scroll', notify);
          notify();
          return () => element.removeEventListener('scroll', notify);
        },
        scrollToFn: (offset, { adjustments }, instance) => {
          if (!instance.scrollElement) return;
          instance.scrollElement.scrollTop = offset + (adjustments ?? 0);
          instance.scrollElement.dispatchEvent(new Event('scroll'));
        },
        measureElement: () => 64,
      }),
  };
});

const retry = vi.fn();
beforeEach(() => {
  retry.mockReset();
  preferences.locale = 'en-US';
  preferences.timezone = 'America/New_York';
  preferences.translations = {};
});

function event(overrides: Partial<DayLogEvent> = {}): DayLogEvent {
  return {
    id: 'receipt-1',
    ts: '2026-11-01T05:30:00Z',
    type: 'door_open',
    layer: 'doors_windows',
    source: 'signal_log',
    vehicle_id: 1,
    payload: { door: 'driver_front', from: false, to: true },
    ...overrides,
  };
}

function mount(overrides: Partial<DayLogTimelineProps> = {}) {
  return render(
    <MemoryRouter>
      <DayLogTimeline
        events={[event()]}
        timezone={preferences.timezone}
        vehicleId={1}
        truncated={false}
        isLoading={false}
        error={null}
        onRetry={retry}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

function history() {
  return Array.from({ length: 90 }, (_, index) => event({
    id: `receipt-${index}`,
    ts: new Date(Date.UTC(2026, 10, 1, 5, index)).toISOString(),
    type: 'signal',
    payload: { field: `Field${index}`, from: false, to: true, future_value: index },
  }));
}

describe('DayLogTimeline assigned receipt correction', () => {
  it('names each disclosure by action, event, local time and exact identity', () => {
    mount({ events: [event(), event({ id: 'receipt-2' })] });
    const first = screen.getByRole('button', { name: 'Show details Door opened 01:30:00 receipt-1' });
    const second = screen.getByRole('button', { name: 'Show details Door opened 01:30:00 receipt-2' });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(first).not.toHaveAttribute('aria-controls');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(first);
    const collapse = screen.getByRole('button', { name: 'Hide details Door opened 01:30:00 receipt-1' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    const target = document.getElementById(collapse.getAttribute('aria-controls') ?? '');
    expect(target).not.toBeNull();
    expect(within(target!).getByText('Timestamp:')).toBeInTheDocument();
    expect(within(target!).getByText('2026-11-01T05:30:00Z')).toBeInTheDocument();
    expect(second).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(collapse);
    expect(target).not.toBeInTheDocument();
    expect(first).toHaveAccessibleName('Show details Door opened 01:30:00 receipt-1');
  });

  it.each([
    { name: 'ordinary state stays neutral', type: 'online', payload: {}, fg: '--text-secondary', bg: '--surface-2' },
    { name: 'unknown source severity stays neutral', type: 'security', payload: { severity: 'new_severity' }, fg: '--text-secondary', bg: '--surface-2' },
    { name: 'hard tire warning uses danger', type: 'tire_warning_on', payload: { severity: 'hard' }, fg: '--semantic-danger', bg: '--semantic-danger-bg' },
    { name: 'soft tire warning uses warning', type: 'tire_warning_on', payload: { severity: 'soft' }, fg: '--semantic-warning', bg: '--semantic-warning-bg' },
    { name: 'cleared tire warning stays neutral', type: 'tire_warning_off', payload: { severity: 'hard' }, fg: '--text-secondary', bg: '--surface-2' },
    { name: 'explicit critical source uses danger', type: 'security', payload: { severity: 'critical' }, fg: '--semantic-danger', bg: '--semantic-danger-bg' },
  ])('$name', ({ type, payload, fg, bg }) => {
    mount({ events: [event({ type, payload })] });
    const row = screen.getByTestId('daylog-event-receipt-1');
    const chip = row.querySelector<HTMLElement>('span[aria-hidden="true"]');
    expect(chip).toHaveClass(`text-[var(${fg})]`, `bg-[var(${bg})]`);
    expect(chip).not.toHaveAttribute('style');
    expect(row).toHaveTextContent(type === 'online' ? 'Online' : type === 'security' ? 'Security event' : type === 'tire_warning_on' ? 'Tire warning' : 'Tire warning cleared');
  });

  it('retains every long detail and SI reading in a wrapping unindented disclosure', () => {
    const identifier = `future:${'x'.repeat(160)}`;
    const place = `Long destination ${'address '.repeat(30)}`;
    mount({ events: [event({
      id: identifier,
      type: 'drive_end',
      source: 'drives',
      layer: 'default',
      ref_kind: 'drive',
      ref_id: 17,
      payload: {
        from: false, to: true, end_place: place, distance_m: 0, duration_s: 60,
        energy_used_wh: 1000, start_soc_pct: 0, end_soc_pct: 50,
        from_raw: 'raw-old', to_raw: 'raw-new', future_flag: false,
        future_text: 'y'.repeat(160),
      },
    })] });
    const link = screen.getByRole('link', { name: 'Drive ended' });
    expect(link).toHaveAttribute('href', '/drives/17');
    expect(link.parentElement).toHaveClass('break-words');
    fireEvent.click(screen.getByRole('button', { name: `Show details Drive ended 01:30:00 ${identifier}` }));
    const button = screen.getByRole('button', { name: `Hide details Drive ended 01:30:00 ${identifier}` });
    const details = document.getElementById(button.getAttribute('aria-controls') ?? '')!;
    expect(details).toHaveClass('min-w-0', 'bg-surface-2');
    expect(details.className).not.toMatch(/\b(?:ml|ms)-/);
    for (const value of [identifier, 'drives', 'default', '2026-11-01T05:30:00Z', '0.00 km', '0.02 h', '1.00 kWh', '0%', '50%', 'raw-old → raw-new', 'false', 'y'.repeat(160)]) {
      expect(within(details).getByText(value)).toBeInTheDocument();
    }
    const placeValue = within(details).getByText(place.trim(), { exact: true });
    expect(placeValue).toHaveClass('min-w-0', 'max-w-full', 'break-words');
    expect(within(details).getByText(identifier)).toHaveClass('break-all');
    expect(within(details).getByText('Future flag:')).toBeInTheDocument();
    expect(within(details).getByText('Future text:')).toBeInTheDocument();
  });

  it('traverses unmounted events with End, arrows and Home while retaining virtualization', async () => {
    mount({ events: history(), timezone: 'UTC' });
    const list = screen.getByRole('list', { name: 'Timeline' });
    expect(list).toHaveAttribute('tabindex', '-1');
    const initial = screen.getByRole('button', { name: 'Show details Signal change 05:00:00 receipt-0' });
    expect(initial).toHaveAttribute('aria-keyshortcuts', 'ArrowDown ArrowUp Home End');
    expect(within(list).getAllByRole('listitem').length).toBeLessThan(90);
    expect(screen.queryByTestId('daylog-event-receipt-89')).toBeNull();
    initial.focus();
    fireEvent.keyDown(initial, { key: 'End' });
    const last = await screen.findByTestId('daylog-event-receipt-89');
    await waitFor(() => expect(within(last).getByRole('button')).toHaveFocus());
    expect(last).toHaveAttribute('aria-posinset', '90');
    expect(last).toHaveAttribute('aria-setsize', '90');
    expect(screen.queryByTestId('daylog-event-receipt-0')).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    await waitFor(() => expect(within(screen.getByTestId('daylog-event-receipt-88')).getByRole('button')).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    await waitFor(() => expect(within(screen.getByTestId('daylog-event-receipt-89')).getByRole('button')).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    const first = await screen.findByTestId('daylog-event-receipt-0');
    const firstButton = within(first).getByRole('button');
    await waitFor(() => expect(firstButton).toHaveFocus());
    fireEvent.keyDown(firstButton, { key: 'ArrowUp' });
    expect(firstButton).toHaveFocus();
    fireEvent.keyDown(firstButton, { key: 'ArrowDown', ctrlKey: true });
    expect(firstButton).toHaveFocus();
    fireEvent.keyDown(firstButton, { key: 'ArrowDown' });
    await waitFor(() => expect(within(screen.getByTestId('daylog-event-receipt-1')).getByRole('button')).toHaveFocus());
    expect(within(list).getAllByRole('listitem').length).toBeLessThan(90);
  });

  it('keeps expanded event identity and payload through unmount and virtual remount', async () => {
    mount({ events: history(), timezone: 'UTC' });
    const list = screen.getByRole('list', { name: 'Timeline' });
    fireEvent.click(screen.getByRole('button', { name: 'Show details Signal change 05:00:00 receipt-0' }));
    fireEvent.keyDown(list, { key: 'End' });
    await screen.findByTestId('daylog-event-receipt-89');
    expect(screen.queryByTestId('daylog-event-receipt-0')).toBeNull();
    fireEvent.keyDown(list, { key: 'Home' });
    const restored = await screen.findByRole('button', { name: 'Hide details Signal change 05:00:00 receipt-0' });
    expect(restored).toHaveAttribute('aria-expanded', 'true');
    const details = document.getElementById(restored.getAttribute('aria-controls') ?? '')!;
    expect(within(details).getByText('Field0')).toBeInTheDocument();
    expect(within(details).getByText('0')).toBeInTheDocument();
  });

  it('searches the full day and restores category selection without dropping event totals', () => {
    mount({ events: history(), timezone: 'UTC' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search events' }), { target: { value: 'Field89' } });
    expect(screen.getByTestId('daylog-count')).toHaveTextContent('Showing 1 of 90 events');
    const last = screen.getByTestId('daylog-event-receipt-89');
    expect(last).toHaveAttribute('aria-posinset', '1');
    expect(last).toHaveAttribute('aria-setsize', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Show all' })[0]);
    expect(screen.getByTestId('daylog-count')).toHaveTextContent('90 events');
    expect(screen.getByRole('textbox', { name: 'Search events' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'other (90)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('preserves repeated DST clock times, raw instants and caller ordering', () => {
    mount({ events: [
      event({ id: 'later', ts: '2026-11-01T06:30:00Z' }),
      event({ id: 'earlier', ts: '2026-11-01T05:30:00Z' }),
    ] });
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('data-testid'))).toEqual(['daylog-event-later', 'daylog-event-earlier']);
    for (const [id, timestamp] of [['later', '2026-11-01T06:30:00Z'], ['earlier', '2026-11-01T05:30:00Z']]) {
      fireEvent.click(screen.getByRole('button', { name: `Show details Door opened 01:30:00 ${id}` }));
      expect(within(screen.getByTestId(`daylog-event-${id}`)).getByText(timestamp)).toBeInTheDocument();
    }
  });

  it('searches displayed seconds across local midnight without changing loaded scope or order', () => {
    preferences.locale = 'de-DE';
    preferences.timezone = 'Asia/Kolkata';
    const events = [
      event({ id: 'after', ts: '2026-11-01T18:30:07Z' }),
      event({ id: 'before', ts: '2026-11-01T18:29:59Z' }),
      event({ id: 'same-clock', ts: '2026-10-31T18:30:07Z' }),
    ];
    mount({ events, truncated: true });
    const search = screen.getByRole('textbox', { name: 'Search events' });
    expect(screen.getByTestId('daylog-event-before')).toHaveTextContent('23:59:59');
    fireEvent.change(search, { target: { value: '00:00:07' } });
    expect(screen.getAllByRole('listitem').map((row) => row.dataset.testid)).toEqual([
      'daylog-event-after', 'daylog-event-same-clock',
    ]);
    expect(screen.getByTestId('daylog-count')).toHaveTextContent('Showing 2 of 3 events');
    expect(screen.getByText(/Some records may be missing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'doors (3)' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '23:59:59' } });
    expect(screen.getByTestId('daylog-event-before')).toBeInTheDocument();
    expect(screen.getByTestId('daylog-count')).toHaveTextContent('Showing 1 of 3 events');
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getAllByRole('listitem').map((row) => row.dataset.testid)).toEqual(
      events.map((receipt) => `daylog-event-${receipt.id}`),
    );
  });

  it('matches translated component titles, descriptions, categories and saved-locale units', () => {
    preferences.locale = 'de-DE';
    preferences.translations = {
      'dayLog.turnSignalTitle.left': 'Linker Blinker',
      'dayLog.turnSignal.off': 'Aus',
      'dayLog.turnSignal.left': 'Links',
      'dayLog.doors.driver_front': 'Fahrertür',
      'dayLog.state.closed': 'Geschlossen',
      'dayLog.state.open': 'Offen',
      'dayLog.categories.doors': 'Türen',
    };
    mount({ events: [
      event({ id: 'turn', type: 'turn_signal', payload: { component: 'left', from: 'off', to: 'left' } }),
      event({ id: 'door' }),
      event({ id: 'drive', type: 'drive_end', payload: { distance_m: 1250 } }),
    ] });
    const search = screen.getByRole('textbox', { name: 'Search events' });
    for (const [query, id] of [
      ['LINKER BLINKER', 'turn'], ['Aus → Links', 'turn'],
      ['Fahrertür · Geschlossen → Offen', 'door'], ['Türen', 'door'],
      ['1,25 km', 'drive'], ['driver_front', 'door'],
    ]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByTestId(`daylog-event-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId('daylog-count')).toHaveTextContent('Showing 1 of 3 events');
    }
  });

  it('keeps invalid and missing dates searchable without fabricating clock times', () => {
    mount({ events: [
      event({ id: 'invalid', ts: 'not-a-date' }),
      event({ id: 'missing', ts: '' }),
      event({ id: 'valid', ts: '2026-11-01T05:30:09Z' }),
    ] });
    const search = screen.getByRole('textbox', { name: 'Search events' });
    for (const [query, id] of [['not-a-date', 'invalid'], ['missing', 'missing'], ['01:30:09', 'valid']]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByTestId(`daylog-event-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId('daylog-count')).toHaveTextContent('Showing 1 of 3 events');
    }
    fireEvent.change(search, { target: { value: 'Invalid Date' } });
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
  });

  it('recomputes a retained time query when the caller changes the scoped timezone', () => {
    const events = [event({ ts: '2026-11-01T05:30:09Z' })];
    const view = mount({ events, timezone: 'UTC' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search events' }), { target: { value: '01:30:09' } });
    expect(screen.getByText('No events match these filters.')).toBeInTheDocument();
    view.rerender(
      <MemoryRouter>
        <DayLogTimeline
          events={events}
          timezone="America/New_York"
          vehicleId={1}
          truncated={false}
          isLoading={false}
          error={null}
          onRetry={retry}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('daylog-event-receipt-1')).toHaveTextContent('01:30:09');
    expect(screen.getByTestId('daylog-count')).toHaveTextContent('Showing 1 of 1 events');
  });
});
