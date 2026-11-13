import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { SignalHistoryResponse } from '@/types/telemetry';
import { getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import SignalChangePointsPage from './SignalChangePointsPage';
import SignalTrendPage from './SignalTrendPage';

const source = vi.hoisted(() => ({
  history: {} as DataStateSource<SignalHistoryResponse>,
  retry: vi.fn(),
}));

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignals: () => ({ data: ['Speed'], isSuccess: true, dataUpdatedAt: 12345 }),
  useSignalAnalysisHistory: () => ({ ...source.history, refetch: source.retry }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7, vehicle: null, vehicles: [], setVehicleId: vi.fn() }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-10-01T00:00:00Z', endInstantExclusive: '2026-10-08T00:00:00Z',
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''),
      ),
  }),
}));

function history(values: readonly number[]): SignalHistoryResponse {
  return {
    vehicleId: 7, signal: 'Speed', from: '2026-10-01T00:00:00Z', to: '2026-10-08T00:00:00Z',
    count: values.length,
    data: values.map((value, index) => ({
      ts: new Date(Date.parse('2026-10-01T00:00:00Z') + index * 3_600_000).toISOString(),
      kind: 'ValueKindDouble', value, ingest_origin: null, source_emitted_at: null,
      received_at: null, normalization_version: null,
    })),
  };
}

function mount(Page: typeof SignalChangePointsPage) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <MemoryRouter><QueryClientProvider client={client}><Page /></QueryClientProvider></MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Signal' }), { target: { value: 'Speed' } });
  return view;
}

beforeEach(() => {
  source.retry.mockClear();
  source.history = { data: history([]), isSuccess: true, dataUpdatedAt: 12345 };
});

describe('real signal interpretation surface consumers', () => {
  it.each([
    { name: 'detected cumulative changes', Page: SignalChangePointsPage, values: Array.from({ length: 60 }, (_, i) => i * 0.01), meaning: /Alarm threshold crossed/, caveat: /does not establish a stable new level/ },
    { name: 'no alarm in measured zeros', Page: SignalChangePointsPage, values: Array.from({ length: 8 }, () => 0), meaning: /No alarm detected/, caveat: /does not establish stability or rule out drift/ },
    { name: 'positive trend', Page: SignalTrendPage, values: Array.from({ length: 30 }, (_, i) => i), meaning: /^Real$/, caveat: /never projected further into the future/ },
    { name: 'negative trend', Page: SignalTrendPage, values: Array.from({ length: 30 }, (_, i) => -i), meaning: /^Real$/, caveat: /never projected further into the future/ },
    { name: 'flat zero signal', Page: SignalTrendPage, values: Array.from({ length: 30 }, () => 0), meaning: /Not significant/, caveat: /best treated as noise/ },
    { name: 'limited trend history', Page: SignalTrendPage, values: [0, 1], meaning: /Evidence-limited/, caveat: /withheld from projection/ },
  ])('binds both native cards for $name while preserving source meanings and chart ownership', ({ Page, values, meaning, caveat }) => {
    const response = history(values);
    const original = structuredClone(response);
    source.history = { data: response, isSuccess: true, dataUpdatedAt: 12345 };
    const { container } = mount(Page);
    const panel = screen.getByText('Reading the result').closest('[data-app-part~="panel"]')!;
    const cards = [...panel.querySelectorAll('[data-app-part~="card"][data-surface-variant="standalone"]')];
    expect(cards).toHaveLength(2);
    expect(cards.some(card => within(card as HTMLElement).queryByText(meaning) !== null)).toBe(true);
    expect(panel).toHaveTextContent(caveat);
    const text = cards.map(card => card.textContent);
    const plots = [...container.querySelectorAll('[data-app-part~="chart-plot"]')];
    expect(plots).toHaveLength(1);
    expect(cards.every(card => !card.hasAttribute('data-app-design-owner'))).toBe(true);
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
      const release = observeAppDesignScopes(container);
      try {
        const sheet = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8'));
        for (const card of cards) {
          let consumed = false;
          sheet.walkRules(rule => {
            if (rule.selector.includes('[data-app-part~="card"]') &&
              rule.nodes.some(node => node.type === 'decl' && node.prop.startsWith('border')) &&
              card.matches(rule.selector)) consumed = true;
          });
          expect(consumed, pack).toBe(true);
          expect(card).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
        }
        expect(cards.map(card => card.textContent)).toEqual(text);
        for (const plot of plots) {
          expect(plot).not.toHaveAttribute('data-surface-variant', 'standalone');
          expect(plot.matches('[data-app-part~="card"]')).toBe(false);
        }
      } finally {
        release();
      }
    }
    expect(response).toEqual(original);
  });

  it.each([SignalChangePointsPage, SignalTrendPage])('does not fabricate interpretation cards for unresolved, invalid or empty evidence', Page => {
    for (const state of [
      { isLoading: true, isPending: true, isFetching: true, fetchStatus: 'fetching' as const },
      { data: history([]), isSuccess: true, dataUpdatedAt: 12345 },
      { data: history([Number.NaN, Number.POSITIVE_INFINITY]), isSuccess: true, dataUpdatedAt: 12345 },
      { error: new Error('history unavailable'), isError: true },
    ]) {
      source.history = state;
      const view = mount(Page);
      const panel = screen.getByText('Reading the result').closest('[data-app-part~="panel"]')!;
      expect(panel.querySelectorAll('[data-app-part~="card"]')).toHaveLength(0);
      expect(screen.getByRole('combobox', { name: 'Signal' })).toHaveValue('Speed');
      expect(view.container.querySelector('[data-app-part~="chart"]')).not.toBeNull();
      view.unmount();
    }
  });
});
