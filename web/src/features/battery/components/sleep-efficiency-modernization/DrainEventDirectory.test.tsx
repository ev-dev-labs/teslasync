import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { MockResizeObserver } from '@/test/setup';
import { analyzeSleepEfficiency } from '../../lib/sleepEfficiencyAnalysis';
import { DrainEventDirectory } from './DrainEventDirectory';
import { sleepEfficiencyFixture } from './sleepEfficiency.fixture';

vi.unmock('@/lib/timezone');
const preferences = vi.hoisted(() => ({
  locale: 'de-DE',
  settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles' },
  vehicle: { timezone: 'Asia/Tokyo' },
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => preferences,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: preferences.vehicle }),
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number) => String(value),
    fmtInt: (value: number) => String(value),
  }),
}));

const observers: MockResizeObserver[] = [];
class MeasuringObserver extends MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    super(callback);
    observers.push(this);
  }
}
const state = {
  vehicleSelected: true, isLoading: false, isResolved: true,
  error: null, refreshError: null, onRetry: vi.fn(),
};
function analysis() {
  return analyzeSleepEfficiency(
    sleepEfficiencyFixture(), Date.parse('2026-08-07T12:00:00Z'),
    '2026-08-04', '2026-08-06',
  );
}
function mount(data = analysis()) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DrainEventDirectory analysis={data} state={state} formatTemperature={value => `${value}°C`} />
      </ToastProvider>
    </MemoryRouter>,
  );
}
function expectedDate(value: string, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    timeZone, year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}
beforeEach(() => {
  preferences.locale = 'de-DE';
  preferences.settings.tz_display_default = 'user';
  preferences.settings.timezone_user = 'America/Los_Angeles';
  observers.length = 0;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DrainEventDirectory preference-aware absolute timestamps', () => {
  it.each([
    ['user', 'de-DE', 'America/Los_Angeles'],
    ['vehicle', 'fr-FR', 'Asia/Tokyo'],
    ['utc', 'en-US', 'UTC'],
  ])('uses saved %s context with %s locale', (mode, locale, timeZone) => {
    preferences.locale = locale;
    preferences.settings.tz_display_default = mode;
    const data = analysis();
    const snapshot = structuredClone(data);
    mount(data);
    const directory = screen.getByTestId('sleep-efficiency-event-directory');
    expect(within(directory).queryByText(/Time zone display:/)).not.toBeInTheDocument();
    for (const event of data.events.directory) {
      expect(within(directory).getByText(expectedDate(event.startDate, locale, timeZone))).toBeInTheDocument();
      expect(within(directory).getByText(expectedDate(event.endDate, locale, timeZone))).toBeInTheDocument();
    }
    // UTC August 6 is August 5 in the saved user zone; display must not rewrite scope or evidence.
    expect(data).toEqual(snapshot);
    expect(data.range.requestedStart).toBe('2026-08-04');
    expect(data.range.requestedEnd).toBe('2026-08-06');
  });

  it('uses the same saved timezone and locale in mobile quick view', () => {
    vi.stubGlobal('ResizeObserver', MeasuringObserver);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 600, x: 0, y: 0, top: 0, left: 0, right: 375, bottom: 600,
      toJSON: () => ({}),
    });
    const data = analysis();
    mount(data);
    act(() => {
      for (const observer of observers) for (const target of observer.observed) observer.trigger(target);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    const event = data.events.directory[0];
    expect(within(dialog).getByText(expectedDate(event.startDate, 'de-DE', 'America/Los_Angeles'))).toBeInTheDocument();
    expect(within(dialog).getByText(expectedDate(event.endDate, 'de-DE', 'America/Los_Angeles'))).toBeInTheDocument();
  });

  it('renders placeholders for invalid or missing display dates without changing validated instants', () => {
    const data = analysis();
    const event = data.events.directory[0];
    const directory = [{ ...event, startDate: 'invalid-date', endDate: '' }];
    mount({ ...data, events: { ...data.events, directory } });
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText(/Invalid Date|NaN/)).not.toBeInTheDocument();
    expect(directory[0].startMs).toBe(event.startMs);
    expect(directory[0].endMs).toBe(event.endMs);
  });

  it('withholds source events with missing or invalid timestamps and retains the directory shell', () => {
    const source = sleepEfficiencyFixture();
    source.recent_events = [
      { ...source.recent_events[0], id: 11, start_date: '' },
      { ...source.recent_events[0], id: 12, end_date: 'invalid-date' },
    ];
    const data = analyzeSleepEfficiency(source, Date.parse('2026-08-07T12:00:00Z'), '2026-08-04', '2026-08-06');
    mount(data);
    expect(data.events.directory).toHaveLength(0);
    expect(screen.getByTestId('sleep-efficiency-event-directory')).toHaveTextContent(
      'No event passed timestamp, future, duration, battery, and duplicate validation.',
    );
    expect(screen.queryByText(/Time zone display:/)).not.toBeInTheDocument();
  });
});
