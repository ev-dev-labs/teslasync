import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import { CommandWorkspace } from './CommandWorkspace';
import type { Vehicle } from '../../commands';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { locale: 'en-US', timezone: 'UTC' }, settingsUnavailable: false }),
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
    const { rerender } = render(<MemoryRouter><CommandWorkspace vehicle={vehicle} state={null} latestCommands={entries} loading={false} onExecute={vi.fn()} /></MemoryRouter>);
    for (const tile of screen.getAllByRole('button', { name: 'Lock', exact: true })) {
      expect(within(tile).getByText(new RegExp(`^${marker} `))).toBeInTheDocument();
      expect(within(tile).getByTestId('command-toggle-reading')).toHaveTextContent('State unknown');
    }
    rerender(<MemoryRouter><CommandWorkspace vehicle={vehicle} state={{ is_locked: true }} latestCommands={[...entries].reverse()} loading={false} onExecute={vi.fn()} /></MemoryRouter>);
    for (const tile of screen.getAllByRole('button', { name: 'Lock', exact: true })) {
      expect(within(tile).getByText(new RegExp(`^${marker} `))).toBeInTheDocument();
      expect(within(tile).getByTestId('command-toggle-reading')).toHaveTextContent('Last known: ON');
    }
  });

  it.each(['fetching', 'paused'] as const)('keeps pending %s distinct from authoritative empty outcomes', (fetchStatus) => {
    const retry = vi.fn();
    render(<MemoryRouter><CommandWorkspace vehicle={vehicle} state={null} latestCommands={[]} loading={false} onExecute={vi.fn()} latestState={deriveDataState({ isPending: true, fetchStatus, refetch: retry })} /></MemoryRouter>);
    expect(screen.getByTestId('command-outcome-source')).toHaveTextContent(fetchStatus === 'paused' ? 'Refresh paused' : 'Loading command activity');
    expect(screen.queryByText('No commands sent yet')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Access & security' })).toBeInTheDocument();
  });

  it('retains paused outcomes with retry and does not assert vehicle connectivity', () => {
    const retry = vi.fn();
    render(<MemoryRouter><CommandWorkspace vehicle={vehicle} state={null} latestCommands={[]} loading={false} onExecute={vi.fn()} latestState={deriveDataState({ data: [], fetchStatus: 'paused', dataUpdatedAt: Date.now(), refetch: retry })} /></MemoryRouter>);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.queryByText('Paused offline')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
