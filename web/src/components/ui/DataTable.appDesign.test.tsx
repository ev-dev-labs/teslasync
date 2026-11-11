import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable, type Column } from './DataTable';
import { getAppDesignAttributes, observeAppDesignScopes } from './app-designs/designs';
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types';
import AuditLogPage from '@/features/notifications/pages/AuditLogPage';
import { NotificationInboxTable } from '@/features/notifications/components/NotificationInboxTable';
import { InstalledInventoryPanel } from '@/features/intelligence-packs/components/InstalledInventoryPanel';
import { PackRepositoryProvider } from '@/features/intelligence-packs/hooks/packRepositoryContext';
import { createInMemoryPackRepository } from '@/features/intelligence-packs/lib/packRepository';
import { installPack } from '@/features/intelligence-packs/lib/packActions';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '@/features/intelligence-packs/lib/catalogFixtures';
import type { NotificationLog } from '@/api/types';
import { request } from '@/api/client';

vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(),
}));

function surfaceRules(name: string) {
  const rules: Rule[] = [];
  postcss.parse(readFileSync(resolve(
    process.cwd(), 'src', 'components', 'ui', 'app-designs', name,
  ), 'utf8')).walkRules(rule => {
    if (rule.selector.includes('[data-app-part~="panel"]')) rules.push(rule);
  });
  return rules;
}

const baseRules = surfaceRules('base.css');
const packRules = new Map(PACK_IDS.map(pack => [pack, surfaceRules(join('packs', `${pack}.css`))]));
function matchingRules(node: Element, rules: readonly Rule[]) {
  return rules.filter(rule => rule.selectors.some(selector => node.matches(selector)));
}

function expectSurface(node: Element, pack: PackId) {
  const base = matchingRules(node, baseRules).find(rule =>
    rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === 'border-radius'));
  expect(base).toBeDefined();
  const identity = matchingRules(node, packRules.get(pack) ?? []);
  expect(identity.length).toBeGreaterThan(0);
  expect(identity.some(rule => rule.nodes.some(declaration => declaration.type === 'decl'
    && ['border', 'background', 'background-color', 'box-shadow'].includes(declaration.prop)))).toBe(true);
  // Selector activation is not a rendered/media-query acceptance claim.
  for (const rule of [base!, ...identity]) {
    expect(rule.parent).toMatchObject({ type: 'atrule', name: 'media', params: 'screen and (forced-colors: none)' });
  }
}

const records = [
  Object.freeze({ id: 0, name: 'Measured zero', reading: 0 }),
  Object.freeze({ id: '0', name: 'Unknown source', reading: null }),
  Object.freeze({ id: 2, name: 'Invalid source', reading: Number.NaN }),
];
const columns: Column<(typeof records)[number]>[] = [
  { key: 'name', header: 'Source', render: row => row.name, sortable: true },
  { key: 'reading', header: 'Reading', render: row => row.reading == null ? 'Not reported'
    : Number.isFinite(row.reading) ? row.reading : 'Invalid' },
];
const table = (caption: string) => <DataTable caption={caption} columns={columns}
  data={records} keyExtractor={row => row.id} searchable={false}
  showDensityControl={false} exportable={false} />;
const clients: QueryClient[] = [];
const releases: Array<() => void> = [];

function client() {
  const value = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(value);
  return value;
}

function observe(host: Element) {
  releases.push(observeAppDesignScopes(host));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(request).mockReset();
});
afterEach(() => {
  releases.splice(0).forEach(release => release());
  cleanup();
  clients.splice(0).forEach(value => value.clear());
  vi.restoreAllMocks();
});

describe('DataTable standalone frame source-to-consumer contracts', () => {
  it.each(PACK_IDS)('%s binds only the painted frame to existing base and identity surface rules', pack => {
    const onSort = vi.fn();
    const onSelectionChange = vi.fn();
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <DataTable caption="Standalone records" columns={columns} data={records}
        keyExtractor={row => row.id} onSort={onSort} maxHeight={240}
        selectable="multi" selectedKeys={[0]} onSelectionChange={onSelectionChange} />
      <DataTable variant="embedded" caption="Embedded records" columns={columns}
        data={records} keyExtractor={row => row.id} />
    </div>);
    observe(container.firstElementChild!);
    const native = screen.getByRole('table', { name: 'Standalone records' });
    const frame = native.closest('[data-app-table-frame]')!;
    expectSurface(frame, pack);
    expect(frame).toHaveAttribute('data-surface-variant', 'standalone');
    expect(frame).toHaveClass('overflow-visible', 'p-0', 'border', 'shadow-e1');
    expect(native.parentElement).toHaveStyle({ maxHeight: '240px' });
    expect(native.querySelector('thead tr')).toHaveClass('sticky', 'top-0');
    expect([...native.querySelectorAll('tbody [data-column-key="name"]')].map(node => node.textContent))
      .toEqual(['Measured zero', 'Unknown source', 'Invalid source']);
    expect(within(native).getByText('0')).toBeInTheDocument();
    expect(within(native).getByText('Not reported')).toBeInTheDocument();
    expect(within(native).getByText('Invalid')).toBeInTheDocument();
    expect(within(native).getByRole('checkbox', { name: 'Deselect Measured zero' })).toBeChecked();
    fireEvent.click(within(native).getByRole('checkbox', { name: 'Select Unknown source' }));
    expect(onSelectionChange).toHaveBeenCalledWith([0, '0']);
    fireEvent.click(within(native).getByRole('button', { name: 'Source' }));
    expect(onSort).toHaveBeenCalledWith('name');

    const embedded = screen.getByRole('table', { name: 'Embedded records' }).closest('[data-app-table-frame]')!;
    expect(embedded).toHaveAttribute('data-grid-variant', 'embedded');
    expect(embedded).not.toHaveAttribute('data-app-part');
    expect(matchingRules(embedded, baseRules)).toEqual([]);
    expect(matchingRules(embedded, packRules.get(pack) ?? [])).toEqual([]);
    expect(embedded).not.toHaveClass('border', 'shadow-e1');
  });

  it('keeps public/widget-only/incomplete previews neutral and uses only the nearest complete profile', async () => {
    const { container } = render(<>
      {table('Public records')}
      <div data-app-design-preview="" data-app-design-pack="blueprint">{table('Widget-only records')}</div>
      <div data-app-design-preview="" {...getAppDesignAttributes('classic')}>
        {table('Outer records')}
        <div data-app-design-preview="" {...getAppDesignAttributes('blueprint')}>{table('Inner records')}</div>
        <div data-app-design-preview="" {...getAppDesignAttributes('v2')} data-app-data="ledger">
          {table('Incomplete records')}
        </div>
      </div>
    </>);
    observe(container);
    const frameFor = (name: string) => screen.getByRole('table', { name }).closest('[data-app-table-frame]')!;
    for (const name of ['Public records', 'Widget-only records', 'Incomplete records']) {
      const frame = frameFor(name);
      expect(frame).not.toHaveAttribute('data-app-design-owner');
      expect(matchingRules(frame, baseRules)).toEqual([]);
      for (const rules of packRules.values()) expect(matchingRules(frame, rules)).toEqual([]);
      expect(frame).toHaveClass('border', 'rounded-xl', 'shadow-e1');
    }
    const outer = frameFor('Outer records');
    const inner = frameFor('Inner records');
    expectSurface(outer, 'classic');
    expectSurface(inner, 'blueprint');
    expect(matchingRules(inner, packRules.get('classic')!)).toEqual([]);
    const host = outer.closest('[data-app-design-preview]')!;
    for (const [name, value] of Object.entries(getAppDesignAttributes('v2'))) host.setAttribute(name, value);
    await waitFor(() => expect(outer.getAttribute('data-app-design-owner')).toContain('pack-v2'));
    expectSurface(outer, 'v2');
    expectSurface(inner, 'blueprint');
    expect(frameFor('Incomplete records')).not.toHaveAttribute('data-app-design-owner');
  });

  it('removes only the surface binding on embedded transitions without remounting rows or losing focus', () => {
    const draw = (variant?: 'standalone' | 'embedded') =>
      <div data-app-design-preview="" {...getAppDesignAttributes('blueprint')}>
        <DataTable variant={variant} caption="Changing frame" columns={columns} data={records}
          keyExtractor={row => row.id} selectable="multi" selectedKeys={[0]} onSelectionChange={vi.fn()} />
      </div>;
    const view = render(draw());
    observe(view.container.firstElementChild!);
    const native = screen.getByRole('table');
    const frame = native.closest('[data-app-table-frame]')!;
    const selected = screen.getByRole('checkbox', { name: 'Deselect Measured zero' });
    selected.focus();
    expectSurface(frame, 'blueprint');
    view.rerender(draw('embedded'));
    expect(screen.getByRole('table')).toBe(native);
    expect(frame).not.toHaveAttribute('data-app-part');
    expect(matchingRules(frame, baseRules)).toEqual([]);
    expect(selected).toBeChecked();
    expect(selected).toHaveFocus();
    view.rerender(draw());
    expectSurface(frame, 'blueprint');
    expect(selected).toHaveFocus();
  });
});

describe('DataTable real standalone consumers (source-only)', () => {
  it('binds the actual audit route frame without changing its returned rows, search or export controls', async () => {
    const rows = [
      { id: 'audit-2', action: 'Original first action', resource: 'scope/first',
        details: 'Retained multiline source\nOriginal second line', createdAt: '2026-06-02T10:00:00Z' },
      { id: 'audit-1', action: 'Original second action', resource: 'scope/second',
        details: null, createdAt: '2026-06-01T10:00:00Z' },
    ];
    vi.mocked(request).mockResolvedValue(rows);
    const { container } = render(<MemoryRouter initialEntries={['/notifications/audit']}>
      <QueryClientProvider client={client()}>
        <div data-app-design-preview="" {...getAppDesignAttributes('classic')}><AuditLogPage /></div>
      </QueryClientProvider>
    </MemoryRouter>);
    observe(container);
    const native = await screen.findByRole('table', { name: 'Recent activity' });
    await waitFor(() => expectSurface(native.closest('[data-app-table-frame]')!, 'classic'));
    expect([...native.querySelectorAll('tbody [data-column-key="action"]')].map(node => node.textContent))
      .toEqual(rows.map(row => row.action));
    expect(within(native).getByText(/Retained multiline source/)).toHaveClass('whitespace-pre-wrap');
    expect(within(native).getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText(/Search by action/), { target: { value: 'Original second action' } });
    await waitFor(() => expect(screen.queryByText('Original first action')).not.toBeInTheDocument());
    expect(within(native).getByText('Original second action')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('/system/audit', expect.anything());
  });

  it.each([
    { archived: false, width: 375 }, { archived: false, width: 640 },
    { archived: true, width: 375 }, { archived: true, width: 640 },
  ])('binds actual inbox/archive frames at $width px (archived=$archived) without replacing source callbacks', async ({ archived, width }) => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-app-table-frame') ? new DOMRect(0, 0, width, 200) : originalRect.call(this);
    });
    const row: NotificationLog = Object.freeze({
      id: 0, channel_id: null, alert_id: null, vehicle_id: null,
      title: 'Original notification', message: 'Original full message', severity: 'custom',
      status: 'pending', error: '', created_at: '2026-06-01T10:00:00Z',
      sent_at: null, read_at: null, archived_at: archived ? '2026-06-02T10:00:00Z' : null,
    });
    const activate = vi.fn();
    const select = vi.fn();
    const { container } = render(<MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes('v2')}>
        <NotificationInboxTable rows={[row]} selectedIds={[]} onSelectionChange={select}
          onActivate={activate} onContextMenu={() => []} ruleMap={{}} vehicleMap={{}}
          archived={archived} filters={{}} onFiltersChange={vi.fn()} />
      </div>
    </MemoryRouter>);
    observe(container);
    const frame = container.querySelector('[data-app-table-frame]')!;
    expectSurface(frame, 'v2');
    expect(frame.querySelector('[data-mobile-table]') != null).toBe(width < 640);
    expect(frame.querySelector('table') != null).toBe(width >= 640);
    fireEvent.click(screen.getByRole('button', { name: width < 640
      ? 'Original notification' : 'Inspect notification: Original notification' }));
    expect(activate).toHaveBeenCalledWith(row);
    expect(activate.mock.calls[0][0]).toBe(row);
    if (width < 640) fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Original notification' }));
    expect(select).toHaveBeenCalledWith([0]);
    expect(screen.getByText('custom')).toBeInTheDocument();
    expect(screen.getByText('Original full message')).toBeInTheDocument();
    expect(row.status).toBe('pending');
    await waitFor(() => expectSurface(frame, 'v2'));
  });

  it('binds the installed-pack frame while retaining the real unresolved-trust guard and disclosure', async () => {
    const repository = createInMemoryPackRepository();
    await installPack(repository, {
      envelope: EFFICIENCY_INSIGHTS_ENVELOPE, enabled: true,
      verification: {
        status: 'signature-valid', recomputedDigestSha256Hex: 'a'.repeat(64),
        recomputedPublisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
        claimedFingerprintMismatch: false, recognizedPublisherName: null, summary: 'Recorded verification',
      },
    });
    const { container } = render(<QueryClientProvider client={client()}>
      <PackRepositoryProvider repository={repository}>
        <div data-app-design-preview="" {...getAppDesignAttributes('blueprint')}><InstalledInventoryPanel /></div>
      </PackRepositoryProvider>
    </QueryClientProvider>);
    observe(container);
    const name = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.name;
    const native = await screen.findByRole('table', { name: 'IntelligencePacksInstalled' });
    await waitFor(() => expectSurface(native.closest('[data-app-table-frame]')!, 'blueprint'));
    const toggle = screen.getByRole('switch', { name: `Enable ${name}` });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    expect((await repository.getInstalled(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id))?.enabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: `Expand row: ${name}` }));
    expect(await screen.findByText('Trust decision: none recorded')).toBeInTheDocument();
    expect(screen.getByText('Capability grant on record')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeEnabled();
  });
});
