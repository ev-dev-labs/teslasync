import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { request } from '@/api/client';
import QuickNavWidget from './QuickNavWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS } from './designPacks/types';
import type { WidgetProps, WidgetSize } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/api/client', () => ({ request: vi.fn() }));

const packs = PACK_IDS.flatMap(pack => pack === 'classic'
  ? []
  : [[pack, PACK_APPEARANCES[pack]] as const]);
const shortcuts = [
  ['Drives', '/drives'], ['Charging', '/charging'],
  ['Analytics', '/analytics'], ['Battery health', '/battery'],
] as const;
const full: WidgetSize = { cols: 4, rows: 2 };
const compact: WidgetSize = { cols: 1, rows: 1 };
const clients: QueryClient[] = [];
const requestMock = vi.mocked(request);

function renderWidget(pack: unknown = 'classic', props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const tree = (requestedPackId: unknown, nextProps = props) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <PackBoundary requestedPackId={requestedPackId}>
          <Routes>
            <Route path="/" element={<QuickNavWidget size={full} {...nextProps} />} />
            {shortcuts.map(([label, path]) => (
              <Route key={path} path={path} element={<h1>{label} destination</h1>} />
            ))}
          </Routes>
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(pack));
  return {
    ...view,
    selectPack: (next: unknown, nextProps?: Partial<WidgetProps>) => view.rerender(tree(next, nextProps ?? props)),
    client,
  };
}

async function expectPack(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(container.querySelector('[data-widget-family="actions"]'))
    .toHaveAttribute('data-widget-appearance', appearance));
}

function expectShortcuts() {
  const nav = screen.getByRole('navigation', { name: 'Quick navigation' });
  expect(screen.getAllByRole('navigation')).toHaveLength(1);
  expect(within(nav).getAllByRole('link')).toHaveLength(4);
  expect(within(nav).getAllByRole('link').map(link => link.getAttribute('href')))
    .toEqual(shortcuts.map(([, path]) => path));
  for (const [label, path] of shortcuts) {
    const link = within(nav).getByRole('link', { name: label });
    expect(link).toHaveAttribute('href', path);
    expect(link).not.toHaveAttribute('aria-disabled');
    expect(link.className).toMatch(/\bmin-h-(?:11|20)\b/);
    expect(link.className).toContain('focus-visible:ring-2');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(within(link).getByText(label)).not.toHaveClass('truncate');
  }
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  return nav;
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockRejectedValue(new Error('Navigation must not request telemetry'));
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
});

describe.each(packs)('Quick navigation %s (%s)', (pack, appearance) => {
  it.each([['full', full], ['compact', compact]] as const)(
    'keeps every real shortcut and its telemetry-independent context in the %s layout',
    async (_layout, size) => {
      const { container, client } = renderWidget(pack, { size });
      await expectPack(container, appearance);
      expectShortcuts();
      expect(screen.getByRole('heading', { name: 'Quick navigation' })).toBeVisible();
      expect(screen.getByText('Shortcuts')).toBeVisible();
      expect(screen.getByText('Dashboard')).toBeVisible();
      expect(screen.getByText('Navigation does not depend on telemetry freshness.')).toBeVisible();
      expect(container.querySelector('[data-instrument-family="actions"]'))
        .toHaveAttribute('data-instrument-appearance', appearance);
      expect(container.querySelectorAll('[data-role="freshness-dot"]')).toHaveLength(1);
      expect(client.getQueryCache().getAll()).toHaveLength(0);
      expect(requestMock).not.toHaveBeenCalled();
    },
  );

  it('keeps focusable native links and navigates to the selected destination', async () => {
    const { container } = renderWidget(pack);
    await expectPack(container, appearance);
    const link = screen.getByRole('link', { name: 'Battery health' });
    link.focus();
    expect(link).toHaveFocus();
    fireEvent.click(link);
    expect(screen.getByRole('heading', { name: 'Battery health destination' })).toBeVisible();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('keeps navigation independent of absent, unknown or changed vehicle/configuration evidence', async () => {
    const { container, selectPack, client } = renderWidget(pack, { size: compact });
    await expectPack(container, appearance);
    expectShortcuts();
    expect(container.querySelector('[data-data-state]')).not.toBeInTheDocument();
    for (const props of [
      { vehicleId: 7, config: { vehicleId: 7, chartType: 'unavailable' } },
      { vehicleId: 999, config: { vehicleId: 999 } },
      { vehicleId: undefined, config: undefined },
    ]) {
      selectPack(pack, { ...props, size: compact });
      expectShortcuts();
      expect(screen.getByText('Navigation does not depend on telemetry freshness.')).toBeVisible();
    }
    expect(container.querySelector('[aria-busy="true"]')).not.toBeInTheDocument();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(requestMock).not.toHaveBeenCalled();
  });
});

it('switches every non-Classic appearance and recovers the original Classic body without a source or selection', async () => {
  const { container, selectPack, client } = renderWidget();
  const classic = expectShortcuts().outerHTML;
  expect(screen.queryByText('Shortcuts')).not.toBeInTheDocument();
  expect(screen.queryByText('Navigation does not depend on telemetry freshness.')).not.toBeInTheDocument();
  for (const [pack, appearance] of packs) {
    selectPack(pack);
    await expectPack(container, appearance);
    expectShortcuts();
  }
  for (const fallback of ['classic', 'retired-pack', null, undefined]) {
    selectPack(fallback);
    expect(container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
    expect(expectShortcuts().outerHTML).toBe(classic);
    expect(screen.queryByText('Shortcuts')).not.toBeInTheDocument();
  }
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  expect(requestMock).not.toHaveBeenCalled();
});
