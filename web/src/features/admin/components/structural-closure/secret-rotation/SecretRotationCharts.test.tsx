import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { request } from '@/api/client';
import { chartTokens } from '@/lib/tokens';
import type { SecretRotationStatus } from '@/types/admin-operator-confidence';
import { useSecretRotationPage } from '../../../hooks/useSecretRotationPage';
import { SecretRotationCharts } from './SecretRotationCharts';

vi.mock('@/api/client', () => ({
  request: vi.fn(),
  isApiError: () => false,
}));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  return {
    ...actual,
    // jsdom has no layout; keep real Recharts axes with a deterministic host.
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width: number; height: number }> }) =>
      cloneElement(children, { width: 480, height: 240 }),
  };
});

const longLabel = 'synthetic_kind · synthetic-target-with-a-complete-long-identity';
const items: SecretRotationStatus[] = [{
  kind: 'synthetic_kind',
  target_id: 'synthetic-target-with-a-complete-long-identity',
  last_rotated: '2026-01-01T00:00:00Z',
  age_days: 80,
  warn_days: 60,
  critical_days: 120,
  expires_at: null,
  days_to_expiry: null,
  severity: 'warn',
}];

function ChartsHarness() {
  return <SecretRotationCharts controller={useSecretRotationPage()} />;
}

function renderCharts() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  const view = () => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ChartsHarness />
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { ...render(view()), client, view };
}

function assertAxisTypography(container: HTMLElement, family: string, size: number) {
  for (const axis of ['xAxis', 'yAxis']) {
    const ticks = container.querySelectorAll(`.recharts-${axis} .recharts-cartesian-axis-tick-value`);
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick).toHaveAttribute('fill', chartTokens.axisStroke);
      expect(tick).toHaveAttribute('font-family', family);
      expect(tick).toHaveAttribute('font-size', String(size));
    }
  }
}

let originalFamily = '';
let originalScale = '';

beforeEach(() => {
  vi.mocked(request).mockReset();
  vi.mocked(request).mockResolvedValue({ items });
  originalFamily = document.documentElement.style.getPropertyValue('--font-sans');
  originalScale = document.documentElement.style.getPropertyValue('--font-scale');
});

afterEach(() => {
  const style = document.documentElement.style;
  if (originalFamily) style.setProperty('--font-sans', originalFamily);
  else style.removeProperty('--font-sans');
  if (originalScale) style.setProperty('--font-scale', originalScale);
  else style.removeProperty('--font-scale');
});

describe('SecretRotationCharts typography', () => {
  it.each([
    { name: 'default text scale', scale: '1', size: 11 },
    { name: 'enlarged text scale', scale: '2', size: 22 },
  ])('uses shared font and chart ink on both axes at $name', async ({ scale, size }) => {
    const family = '"Synthetic Sans", sans-serif';
    document.documentElement.style.setProperty('--font-sans', family);
    document.documentElement.style.setProperty('--font-scale', scale);
    const { container, client } = renderCharts();

    await waitFor(() => assertAxisTypography(container, family, size));
    expect(container.querySelector('.recharts-yAxis')).toHaveTextContent('synthetic_kind · synt…');
    expect(container.querySelector('.recharts-xAxis')).toHaveTextContent('80.00d');
    expect(screen.getAllByText(longLabel).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rotate soon').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.recharts-bar')).toHaveLength(1);
    expect(container.querySelectorAll('.recharts-pie')).toHaveLength(1);
    expect(client.getQueryCache().getAll()[0].state.data).toEqual({ items });
  });

  it('refreshes both axis fonts on rerender without changing the raw series or complete labels', async () => {
    document.documentElement.style.setProperty('--font-sans', '"Synthetic Initial", sans-serif');
    document.documentElement.style.setProperty('--font-scale', '1');
    const { container, client, rerender, view } = renderCharts();
    await waitFor(() => assertAxisTypography(container, '"Synthetic Initial", sans-serif', 11));

    document.documentElement.style.setProperty('--font-sans', '"Synthetic Updated", serif');
    document.documentElement.style.setProperty('--font-scale', '2');
    rerender(view());

    await waitFor(() => assertAxisTypography(container, '"Synthetic Updated", serif', 22));
    expect(screen.getAllByText(longLabel).length).toBeGreaterThan(0);
    expect(container.querySelector('.recharts-xAxis')).toHaveTextContent('80.00d');
    expect(client.getQueryCache().getAll()[0].state.data).toEqual({ items });
  });

  it('keeps scaled axes, both charts and full data labels through a retained refresh failure', async () => {
    document.documentElement.style.setProperty('--font-sans', '"Synthetic Retained", sans-serif');
    document.documentElement.style.setProperty('--font-scale', '2');
    const { container, client } = renderCharts();
    await waitFor(() => assertAxisTypography(container, '"Synthetic Retained", sans-serif', 22));

    vi.mocked(request).mockRejectedValue(new Error('synthetic refresh unavailable'));
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(client.getQueryCache().getAll()[0].state.error).not.toBeNull());

    assertAxisTypography(container, '"Synthetic Retained", sans-serif', 22);
    expect(container.querySelectorAll('.recharts-bar')).toHaveLength(1);
    expect(container.querySelectorAll('.recharts-pie')).toHaveLength(1);
    expect(screen.getAllByText(longLabel).length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(client.getQueryCache().getAll()[0].state.data).toEqual({ items });
  });
});
