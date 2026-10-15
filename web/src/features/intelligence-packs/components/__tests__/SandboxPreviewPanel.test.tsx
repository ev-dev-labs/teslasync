import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';

import { renderWithProviders } from './testUtils';
import { SandboxPreviewPanel } from '../SandboxPreviewPanel';
import { createInMemoryPackRepository, type PackRepository } from '../../lib/packRepository';
import { installPack } from '../../lib/packActions';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
import type { VerificationResult } from '../../lib/verifyEnvelope';
import { intelPackQueryKeys } from '../../hooks/queryKeys';
import { Area, AreaChart, Bar, BarChart, Line, LineChart } from '@/components/charts';
import { useChartPalette, CHART_PALETTES } from '@/hooks/useChartPalette';
import { runSandboxPreview } from '../../lib/sandboxRunner';

vi.mock('@/hooks/useChartPalette', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useChartPalette')>();
  return { ...actual, useChartPalette: vi.fn(() => actual.CHART_PALETTES.cb_safe) };
});

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  const { createElement } = await import('react');
  const container = ({ children }: { children?: import('react').ReactNode }) => createElement('div', null, children);
  return {
    ...actual,
    ...chartTestDoubles,
    ResponsiveContainer: container,
    LineChart: vi.fn(container),
    AreaChart: vi.fn(container),
    BarChart: vi.fn(container),
    Line: vi.fn(() => null),
    Area: vi.fn(() => null),
    Bar: vi.fn(() => null),
  };
});

const signedVerification: VerificationResult = {
  status: 'signature-valid',
  recomputedDigestSha256Hex: 'a'.repeat(64),
  recomputedPublisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
  claimedFingerprintMismatch: false,
  recognizedPublisherName: 'TeslaSync Labs (Sample Publisher)',
  summary: 'ok',
};

async function installedRepository() {
  const repository = createInMemoryPackRepository();
  await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
  await repository.putTrustDecision({
    packId: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id,
    decision: 'trusted-signed-recognized',
    publisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
    decidedAtIso: '2026-10-01T10:00:00Z',
    approvedCapabilities: ['render:dashboard'],
  });
  return repository;
}

afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('SandboxPreviewPanel', () => {
  it('uses the existing palette for every chart mode without changing populated formula series', async () => {
    const manifest = EFFICIENCY_INSIGHTS_ENVELOPE.manifest;
    const run = runSandboxPreview(manifest, new Set(manifest.capabilities));
    renderWithProviders(<SandboxPreviewPanel />);
    await screen.findByText('Efficiency Starter Dashboard');

    const assertCharts = (palette: readonly string[]) => {
      expect(vi.mocked(Line).mock.lastCall?.[0]).toMatchObject({ stroke: palette[0], dataKey: 'value' });
      expect(vi.mocked(Area).mock.lastCall?.[0]).toMatchObject({
        stroke: palette[1], fill: palette[1], fillOpacity: 0.08, dataKey: 'value',
      });
      expect(vi.mocked(Bar).mock.lastCall?.[0]).toMatchObject({ fill: palette[2], dataKey: 'value' });
      for (const [chart, formulaId] of [
        [LineChart, 'efficiency-gap'],
        [AreaChart, 'battery-headroom'],
        [BarChart, 'charge-added'],
      ] as const) {
        const formula = run.formulas.find((result) => result.formulaId === formulaId);
        expect(formula?.series.length).toBeGreaterThan(0);
        expect(vi.mocked(chart).mock.lastCall?.[0]).toMatchObject({
          data: formula?.series.map((value, i) => ({ i, value })),
        });
      }
      const sparkline = screen.getByRole('img', { name: 'Efficiency Gap Trend' });
      expect(sparkline.querySelector('polyline')).toHaveAttribute('stroke', palette[0]);
    };

    assertCharts(CHART_PALETTES.cb_safe);
    const sparklinePoints = screen.getByRole('img', { name: 'Efficiency Gap Trend' })
      .querySelector('polyline')?.getAttribute('points');
    vi.mocked(useChartPalette).mockReturnValue(CHART_PALETTES.neon);
    const select = screen.getByLabelText(/Pack to preview/i);
    fireEvent.change(select, { target: { value: 'community-speed-temp-explorer' } });
    fireEvent.change(select, { target: { value: manifest.id } });
    assertCharts(CHART_PALETTES.neon);
    expect(screen.getByRole('img', { name: 'Efficiency Gap Trend' }).querySelector('polyline'))
      .toHaveAttribute('points', sparklinePoints);
  });

  it('keeps the synthetic simulation visible while the installed grant is actively loading', async () => {
    const repository = await installedRepository();
    const grant = await repository.getTrustDecision(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
    let resolve!: (value: typeof grant) => void;
    vi.spyOn(repository, 'getTrustDecision').mockReturnValue(new Promise((done) => { resolve = done; }));
    renderWithProviders(<SandboxPreviewPanel />, { repository });

    expect(await screen.findByText('Loading Using installed capability grant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(screen.getByText(/Installed pack: synthetic preview is simulating/i)).toBeInTheDocument();
    expect(screen.getByText('Efficiency Starter Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/Runs entirely offline against bundled synthetic/i)).toBeInTheDocument();
    await act(async () => { resolve(grant); });
    expect(await screen.findByText(/^Using installed capability grant$/)).toBeInTheDocument();
    expect(screen.queryByText('Loading Using installed capability grant')).not.toBeInTheDocument();
  });

  it('reports paused without data instead of inferring an empty grant and retries the trust source', async () => {
    const repository = await installedRepository();
    // Keep inventory available so only the trust source is paused.
    const records = await repository.listInstalled();
    onlineManager.setOnline(false);
    const { client } = renderWithProviders(<SandboxPreviewPanel />, { repository });
    await act(async () => {
      client.setQueryData(intelPackQueryKeys.installed, records);
    });
    expect(await screen.findByText(/The local Using installed capability grant read is paused/i)).toBeInTheDocument();
    expect(screen.queryByText('Loading Using installed capability grant')).not.toBeInTheDocument();
    expect(screen.getByText(/Installed pack: synthetic preview is simulating/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => { onlineManager.setOnline(true); });
    expect(await screen.findByText(/^Using installed capability grant$/)).toBeInTheDocument();
    expect(screen.queryByText(/read is paused/i)).not.toBeInTheDocument();
  });

  it('treats a successful absent decision as synthetic simulation and an empty approved grant as real zero output', async () => {
    const repository = await installedRepository();
    const grant = await repository.getTrustDecision(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
    const read = vi.spyOn(repository, 'getTrustDecision').mockResolvedValue(null);
    const { client } = renderWithProviders(<SandboxPreviewPanel />, { repository });
    await waitFor(() => expect(client.getQueryState(intelPackQueryKeys.trust(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id))?.status).toBe('success'));
    expect(screen.getByText(/Installed pack: synthetic preview is simulating/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    if (!grant) throw new Error('Expected the installed trust fixture');
    read.mockResolvedValue({ ...grant, approvedCapabilities: [] });
    await act(async () => {
      await client.invalidateQueries({ queryKey: intelPackQueryKeys.trust(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id) });
    });
    expect(await screen.findByText(/^Using installed capability grant$/)).toBeInTheDocument();
    expect(screen.getByText('0.00 flag')).toBeInTheDocument();
    expect(screen.getByText('avg 0.00 flag')).toBeInTheDocument();
    expect(screen.getAllByText(/capability denied/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Installed pack: synthetic preview is simulating/i)).not.toBeInTheDocument();
  });

  it('retains installed settings and sandbox output through refresh failure, paused refresh and recovery', async () => {
    const repository = await installedRepository();
    const grant = await repository.getTrustDecision(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
    const read = vi.spyOn(repository, 'getTrustDecision');
    const { client, container } = renderWithProviders(<SandboxPreviewPanel />, { repository });
    await screen.findByText(/^Using installed capability grant$/);
    const widgetOutput = () => Array.from(container.querySelectorAll('[data-card-title]'))
      .map((title) => title.closest('[data-card]')?.textContent);
    const before = widgetOutput();
    read.mockRejectedValue(new Error('Trust source refresh failed'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: intelPackQueryKeys.trust(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id) });
    });
    expect(await screen.findByText(/Could not read Using installed capability grant/i)).toBeInTheDocument();
    expect(screen.getByText(/Using installed capability grant may be out of date/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Using installed capability grant$/)).not.toBeInTheDocument();
    expect(widgetOutput()).toEqual(before);
    expect(client.getQueryData(intelPackQueryKeys.trust(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id))).toEqual(grant);
    expect(screen.getByText(/Runs entirely offline against bundled synthetic/i)).toBeInTheDocument();

    onlineManager.setOnline(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/read is paused/i)).toBeInTheDocument();
    expect(widgetOutput()).toEqual(before);
    read.mockResolvedValue(grant);
    await act(async () => { onlineManager.setOnline(true); });
    await screen.findByText(/^Using installed capability grant$/);
    expect(screen.queryByText(/Could not read Using installed capability grant/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/may be out of date/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(widgetOutput()).toEqual(before);
  });

  it('defaults to the first catalog entry and renders its dashboard widgets', async () => {
    renderWithProviders(<SandboxPreviewPanel />);
    expect(await screen.findByText('Efficiency Starter Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/simulating full requested-capability grant/i)).toBeInTheDocument();
    const evaluation = await screen.findByRole('region', { name: 'Selected pack evaluation' });
    expect(await within(evaluation).findByText(/^sample rows$/i)).toBeInTheDocument();
  });

  it('uses the installed capability grant (not the full request) once a pack is installed with partial trust', async () => {
    const repository: PackRepository = createInMemoryPackRepository();
    await installPack(repository, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification: signedVerification, enabled: true });
    // Only approve a subset of what the manifest requests.
    await repository.putTrustDecision({
      packId: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id,
      decision: 'trusted-signed-recognized',
      publisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
      decidedAtIso: new Date().toISOString(),
      approvedCapabilities: ['render:dashboard'],
    });

    renderWithProviders(<SandboxPreviewPanel />, { repository });

    const select = await screen.findByLabelText(/Pack to preview/i);
    fireEvent.change(select, { target: { value: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id } });

    await waitFor(() => {
      expect(screen.getByText(/Using installed capability grant/i)).toBeInTheDocument();
    });
    // Fields denied by the (partial) capability grant show up on at least one widget.
    expect(await screen.findAllByText(/capability denied/i)).not.toHaveLength(0);
  });
});
