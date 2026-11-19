import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveDataState } from '@/api/dataState';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import { CommandWorkspace } from './CommandWorkspace';
import { COMMANDS, type Vehicle } from '../../commands';
import { COMMAND_BOARD_GROUPS } from './commandBoard';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { locale: 'en-US', timezone: 'UTC' }, settingsUnavailable: false }),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({
  useVehicleLiveSignals: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => typeof fallback === 'string'
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? name))
      : key,
    i18n: { language: 'en' },
  }),
}));

const vehicle: Vehicle = { id: 42, vin: 'QA', state: 'online', display_name: 'QA', model: 'Model 3', updated_at: '2026-10-14T00:00:00Z' };

function outcome(id: number, command: string, status: string, created_at: string): CommandLogEntry {
  return { id, vehicle_id: vehicle.id, command, status, created_at, params: '', error: '' };
}

function renderWithQueryClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => localStorage.clear());

function home(id: string) {
  return within(document.querySelector(`[data-command-id="${id}"]`) as HTMLElement);
}

describe('CommandWorkspace control board', () => {
  const props = { vehicle, state: null, latestCommands: [], loading: false, onExecute: vi.fn() };

  it('gives every registry ID exactly one visible home in twelve expanded cards', () => {
    renderWithQueryClient(<MemoryRouter><CommandWorkspace {...props} /></MemoryRouter>);
    expect(COMMAND_BOARD_GROUPS.flatMap(group => group.ids).sort()).toEqual(COMMANDS.map(def => def.id).sort());
    expect(document.querySelectorAll('[data-command-card]')).toHaveLength(12);
    for (const def of COMMANDS) {
      expect(document.querySelectorAll(`[data-command-id="${def.id}"]`)).toHaveLength(1);
      expect(document.querySelector(`[data-command-id="${def.id}"]`)).toBeVisible();
    }
    expect(screen.queryByText('Quick actions')).not.toBeInTheDocument();
  });

  it('renders distinct vehicle glyphs for paired actions', () => {
    renderWithQueryClient(<MemoryRouter><CommandWorkspace {...props} /></MemoryRouter>);
    for (const [first, second] of [
      ['frunk_open', 'trunk_open'],
      ['vent_windows', 'close_windows'],
      ['sunroof_vent', 'sunroof_close'],
      ['seat_heater', 'seat_cooler'],
    ]) {
      const firstGlyph = document.querySelector(`[data-command-id="${first}"] svg`);
      const secondGlyph = document.querySelector(`[data-command-id="${second}"] svg`);
      expect(firstGlyph).toBeVisible();
      expect(secondGlyph).toBeVisible();
      expect(firstGlyph?.innerHTML).not.toBe(secondGlyph?.innerHTML);
    }
  });

  it('filters cards, highlights matches in place, and restores the board when cleared', () => {
    renderWithQueryClient(<MemoryRouter><CommandWorkspace {...props} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'vent_windows' } });
    expect(document.querySelectorAll('[data-command-card]')).toHaveLength(1);
    expect(document.querySelector('[data-command-id="vent_windows"]')).toHaveAttribute('data-command-match', 'true');
    expect(home('close_windows').getByRole('button', { name: 'Close windows', exact: true })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'no-such-command' } });
    expect(screen.getByText('No matching commands')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(document.querySelectorAll('[data-command-id]')).toHaveLength(COMMANDS.length);
  });

  it('keeps pins vehicle-specific without duplicating homes and permits unpinning from the filtered board', () => {
    const { rerender } = renderWithQueryClient(<MemoryRouter><CommandWorkspace {...props} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }));
    fireEvent.click(home('flash_lights').getByRole('button', { name: 'Pin Flash lights' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pinned only' }));
    expect(home('flash_lights').getByRole('button', { name: 'Flash lights', exact: true })).toBeVisible();
    expect(document.querySelector('[data-command-id="navigation_request"]')).not.toBeInTheDocument();
    rerender(<MemoryRouter><CommandWorkspace {...props} vehicle={{ ...vehicle, id: 43 }} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }));
    expect(home('flash_lights').getByRole('button', { name: 'Pin Flash lights' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<MemoryRouter><CommandWorkspace {...props} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit pins' }));
    expect(home('flash_lights').getByRole('button', { name: 'Pin Flash lights' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Pinned only' }));
    fireEvent.click(home('flash_lights').getByRole('button', { name: 'Pin Flash lights' }));
    expect(document.querySelector('[data-command-id="flash_lights"]')).not.toBeInTheDocument();
  });

  it('discards drafts and open dialogs on a vehicle change or transition to read-only', () => {
    const onExecute = vi.fn();
    const { rerender } = renderWithQueryClient(<MemoryRouter><CommandWorkspace {...props} onExecute={onExecute} /></MemoryRouter>);
    fireEvent.change(home('set_charge_limit').getByLabelText('Set limit'), { target: { value: '94' } });
    fireEvent.click(home('valet_mode').getByRole('button', { name: 'ON' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    rerender(<MemoryRouter><CommandWorkspace {...props} vehicle={{ ...vehicle, id: 43 }} onExecute={onExecute} /></MemoryRouter>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(home('set_charge_limit').getByLabelText('Set limit')).toHaveValue('80');
    fireEvent.change(home('set_charge_limit').getByLabelText('Set limit'), { target: { value: '95' } });
    rerender(<MemoryRouter><CommandWorkspace {...props} vehicle={{ ...vehicle, id: 43 }} onExecute={onExecute} disabled /></MemoryRouter>);
    expect(home('set_charge_limit').getByLabelText('Set limit')).toHaveValue('80');
    expect(home('set_charge_limit').getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onExecute).not.toHaveBeenCalled();
  });

  it.each([
    ['set_temps', '22.5', 'set_temps', { driver_temp: '22.5', passenger_temp: '22.5' }],
    ['schedule_software_update', '2', 'schedule_software_update', { offset_sec: '120' }],
    ['navigation_sc_request', '123', 'navigation_sc_request', { order: 0, id: 123 }],
    ['navigation_request', 'Test destination', 'navigation_request', { type: 'share_ext_content_raw', value: { 'android.intent.extra.TEXT': 'Test destination' }, locale: 'en-US' }],
  ])('retains the registry payload for inline %s and sends only on Apply', (id, value, command, params) => {
    const onExecute = vi.fn();
    renderWithQueryClient(<MemoryRouter><CommandWorkspace {...props} onExecute={onExecute} /></MemoryRouter>);
    fireEvent.change(home(String(id)).getByRole('textbox'), { target: { value } });
    fireEvent.blur(home(String(id)).getByRole('textbox'));
    expect(onExecute).not.toHaveBeenCalled();
    fireEvent.click(home(String(id)).getByRole('button', { name: 'Apply' }));
    expect(onExecute).toHaveBeenCalledExactlyOnceWith(command, params);
  });

  it('rejects invalid inline values and leaves slider edits unsent', () => {
    const onExecute = vi.fn();
    renderWithQueryClient(<MemoryRouter><CommandWorkspace {...props} onExecute={onExecute} /></MemoryRouter>);
    const limit = home('set_charge_limit');
    fireEvent.change(limit.getByRole('slider'), { target: { value: '92' } });
    expect(limit.getByRole('textbox')).toHaveValue('92');
    expect(onExecute).not.toHaveBeenCalled();
    for (const value of ['101', '49', 'abc', '80.5', '']) {
      fireEvent.change(limit.getByRole('textbox'), { target: { value } });
      fireEvent.blur(limit.getByRole('textbox'));
      expect(limit.getByRole('button', { name: 'Apply' })).toBeDisabled();
      expect(limit.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    }
    expect(onExecute).not.toHaveBeenCalled();
  });
});

describe('CommandWorkspace — independent outcome source', () => {
  it.each([
    {
      name: 'newer OFF failure despite an older ON success and higher ON id',
      entries: [outcome(20, 'lock', 'success', '2026-10-14T00:00:00Z'), outcome(10, 'unlock', 'failed', '2026-10-14T01:00:00Z')],
      marker: '✗',
    },
    {
      name: 'newer ON success despite an older OFF failure',
      entries: [outcome(10, 'unlock', 'failed', '2026-10-14T00:00:00Z'), outcome(20, 'lock', 'success', '2026-10-14T01:00:00Z')],
      marker: '✓',
    },
    {
      name: 'higher OFF id when timestamps match',
      entries: [outcome(20, 'unlock', 'failed', '2026-10-14T01:00:00Z'), outcome(10, 'lock', 'success', '2026-10-14T01:00:00Z')],
      marker: '✗',
    },
    {
      name: 'higher ON id when timestamps match',
      entries: [outcome(10, 'unlock', 'failed', '2026-10-14T01:00:00Z'), outcome(20, 'lock', 'success', '2026-10-14T01:00:00Z')],
      marker: '✓',
    },
    {
      name: 'populated ON-only success',
      entries: [outcome(10, 'lock', 'success', '2026-10-14T01:00:00Z')],
      marker: '✓',
    },
    {
      name: 'populated OFF-only failure',
      entries: [outcome(10, 'unlock', 'failed', '2026-10-14T01:00:00Z')],
      marker: '✗',
    },
    {
      name: 'newest outcome independent of duplicate-name array order',
      entries: [outcome(20, 'lock', 'failed', '2026-10-14T01:00:00Z'), outcome(10, 'lock', 'success', '2026-10-14T00:00:00Z')],
      marker: '✗',
    },
  ])('preserves $name without inferring physical state', ({ entries, marker }) => {
    const { rerender } = renderWithQueryClient(<MemoryRouter><CommandWorkspace vehicle={vehicle} state={null} latestCommands={entries} loading={false} onExecute={vi.fn()} /></MemoryRouter>);
    for (const tile of screen.getAllByRole('group', { name: 'Lock', exact: true })) {
      expect(within(tile).getByText(new RegExp(`Last request: ${marker} `))).toBeInTheDocument();
      expect(within(tile).getByTestId('command-toggle-reading')).toHaveTextContent('State unknown');
    }
    rerender(<MemoryRouter><CommandWorkspace vehicle={vehicle} state={{ is_locked: true }} latestCommands={[...entries].reverse()} loading={false} onExecute={vi.fn()} /></MemoryRouter>);
    for (const tile of screen.getAllByRole('group', { name: 'Lock', exact: true })) {
      expect(within(tile).getByText(new RegExp(`Last request: ${marker} `))).toBeInTheDocument();
      expect(within(tile).getByTestId('command-toggle-reading')).toHaveTextContent('Last known: ON');
    }
  });

  it.each(['fetching', 'paused'] as const)('keeps pending %s distinct from authoritative empty outcomes', (fetchStatus) => {
    const retry = vi.fn();
    renderWithQueryClient(<MemoryRouter><CommandWorkspace vehicle={vehicle} state={null} latestCommands={[]} loading={false} onExecute={vi.fn()} latestState={deriveDataState({ isPending: true, fetchStatus, refetch: retry })} /></MemoryRouter>);
    expect(screen.getByTestId('command-outcome-source')).toHaveTextContent(fetchStatus === 'paused' ? 'Refresh paused' : 'Loading command activity');
    expect(screen.queryByText('No commands sent yet')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Access', exact: true })).toBeVisible();
  });

  it('retains paused outcomes with retry and does not assert vehicle connectivity', () => {
    const retry = vi.fn();
    renderWithQueryClient(<MemoryRouter><CommandWorkspace vehicle={vehicle} state={null} latestCommands={[]} loading={false} onExecute={vi.fn()} latestState={deriveDataState({ data: [], fetchStatus: 'paused', dataUpdatedAt: Date.now(), refetch: retry })} /></MemoryRouter>);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.queryByText('Paused offline')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
