import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { ConnectionPool, DBStats, MigrationStatus } from '@/types/admin';
import { DBHealthSummary } from './DBHealthSummary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match),
  }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: {
    locale: 'en-US', decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', currency_symbol: '$',
  }, settingsUnavailable: false }),
}));

const stats: DBStats = { databaseSize: '512.25', tableCount: 0, tables: [] };
const migration: MigrationStatus = { currentVersion: '185', dirty: false, pending: 0, migrations: [] };
const pool: ConnectionPool = { maxOpen: 25, open: 10, inUse: 5, idle: 5, waitCount: 0, waitDurationMs: 0 };
const props = {
  stats: deriveDataState({ data: stats, dataUpdatedAt: 1000 }),
  migration: deriveDataState({ data: migration, dataUpdatedAt: 2000 }),
  pool: deriveDataState({ data: pool, dataUpdatedAt: 3000 }),
  statsLoading: false, migrationLoading: false, poolLoading: false,
  sizeBytes: 512.25, totalRows: 0, largeTables: 0, migrationVersion: '185', migrationDirty: false, poolUsage: 20,
};
afterEach(cleanup);

describe('DB health canonical summary preservation', () => {
  it('renders exactly six typed tiles and preserves byte precision, zero counts and migration status context', () => {
    const { container } = render(<MemoryRouter><DBHealthSummary {...props} /></MemoryRouter>);
    const tiles = [...container.querySelectorAll('[data-operational-metric]')];
    expect(tiles).toHaveLength(6);
    expect(tiles.map(tile => tile.querySelector('[data-operational-value]')?.textContent))
      .toEqual(['512.25 B', '0', '0', '0', '185', '20.00%']);
    expect(tiles[3]).toHaveTextContent('> 100 MB');
    expect(tiles[4]).toHaveTextContent('Clean');
    expect(tiles[5].querySelector('[data-operational-value]')).toHaveTextContent('%');
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(3);
    expect(screen.getByTestId('db-health-summary-0')).toHaveTextContent('1970-01-01T00:00:01.000Z');
    expect(screen.getByTestId('db-health-summary-1')).toHaveTextContent('1970-01-01T00:00:02.000Z');
    expect(screen.getByTestId('db-health-summary-2')).toHaveTextContent('1970-01-01T00:00:03.000Z');
  });

  it('does not spread one source loading or refresh failure to the other sources', () => {
    render(<MemoryRouter><DBHealthSummary {...props}
      stats={deriveDataState<DBStats>({ isLoading: true })} statsLoading
      sizeBytes={null} totalRows={null} largeTables={null}
      migration={deriveDataState({ data: migration, error: new Error('migration failed') })} /></MemoryRouter>);
    expect(screen.getByTestId('db-health-summary-0').querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByTestId('db-health-summary-0')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('db-health-summary-1')).toHaveTextContent('Retained source');
    expect(screen.getByTestId('db-health-summary-1')).toHaveTextContent('185');
    expect(screen.getByTestId('db-health-summary-2')).toHaveTextContent('Source loaded');
    expect(screen.getByTestId('db-health-summary-2').querySelector('[data-operational-value]')).toHaveTextContent('20.00%');
  });

  it('retains DB-specific fixed precision below a kilobyte instead of generic raw-byte notation', () => {
    const { container } = render(<MemoryRouter><DBHealthSummary {...props} sizeBytes={512} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="db-total-size"] [data-operational-value]')).toHaveTextContent('512.00 B');
  });

  it('preserves zero bytes and zero pool usage but withholds absent statistics and migration health', () => {
    const { container, rerender } = render(<MemoryRouter><DBHealthSummary {...props}
      sizeBytes={0} poolUsage={0} migrationVersion={0} /></MemoryRouter>);
    expect(container.querySelector('[data-operational-metric="db-total-size"] [data-operational-value]')).toHaveTextContent('0.00 B');
    expect(container.querySelector('[data-operational-metric="db-pool-usage"] [data-operational-value]')).toHaveTextContent('0.00%');
    expect(container.querySelector('[data-operational-metric="db-migration-version"] [data-operational-value]')).toHaveTextContent('0');
    rerender(<MemoryRouter><DBHealthSummary {...props}
      stats={deriveDataState<DBStats>({})} sizeBytes={null} totalRows={null} largeTables={null}
      migration={deriveDataState<MigrationStatus>({})} migrationVersion="—" migrationDirty={null}
      pool={deriveDataState<ConnectionPool>({})} poolUsage={null} /></MemoryRouter>);
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(6);
    expect(screen.queryByText('Clean')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Last successful fetch time unknown/)).toHaveLength(3);
  });
  it('opens a real source review drawer while leaving the other independent briefs mounted', () => {
    render(<MemoryRouter><DBHealthSummary {...props} /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Review details' })[1]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('db-health-summary-0')).toBeInTheDocument();
    expect(screen.getByTestId('db-health-summary-2')).toBeInTheDocument();
  });
});
