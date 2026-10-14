import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
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

describe('CommandWorkspace — independent outcome source', () => {
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
