import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

import { SandboxPreviewPanel } from '../SandboxPreviewPanel';
import { PackDetailModal } from '../PackDetailModal';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
import { runSandboxPreview, type SandboxRunResult } from '../../lib/sandboxRunner';
import { createInMemoryPackRepository } from '../../lib/packRepository';
import { installPack } from '../../lib/packActions';
import { intelPackQueryKeys } from '../../hooks/queryKeys';
import { renderWithProviders as renderPack } from './testUtils';

function renderWithProviders(ui: ReactElement, options?: Parameters<typeof renderPack>[1]) {
  return renderPack(<MemoryRouter>{ui}</MemoryRouter>, options);
}

let runOverride: SandboxRunResult | undefined;

vi.mock('../../hooks/useSandboxPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useSandboxPreview')>();
  return {
    ...actual,
    useSandboxPreview: (...args: Parameters<typeof actual.useSandboxPreview>) => {
      const run = actual.useSandboxPreview(...args);
      return runOverride ?? run;
    },
  };
});

const manifest = EFFICIENCY_INSIGHTS_ENVELOPE.manifest;

function preparedRun(): SandboxRunResult {
  return {
    formulas: manifest.formulas.map((formula) => ({
      formulaId: formula.id,
      label: formula.label,
      unit: formula.unit,
      series: [-12.5, 0, 7.25, 15, 23.5],
      latest: 23.5,
      average: 6.65,
      budgetError: null,
      deniedFieldRefs: [],
    })),
    rowsUsed: 5,
    totalStepsUsed: 117,
    durationMs: 2,
    truncated: false,
  };
}

function widget(title: string) {
  const headings = screen.getAllByText(title, { selector: '[data-card-title]' });
  const card = headings[0].closest('[data-card]');
  if (!(card instanceof HTMLElement)) throw new Error(`Missing widget card for ${title}`);
  return within(card);
}

describe('Sandbox actual-component content preservation', () => {
  let originalPreferences = getFormatterPreferences();
  beforeEach(() => {
    runOverride = undefined;
    originalPreferences = getFormatterPreferences();
  });
  afterEach(() => {
    setGlobalPrecision(originalPreferences.precision);
    setGlobalLocale(originalPreferences.locale);
  });

  it('renders every real synthetic widget in manifest order with every chart-table sample intact', () => {
    const expected = runSandboxPreview(manifest, new Set(manifest.capabilities));
    const { container } = renderWithProviders(<SandboxPreviewPanel />);
    const titles = Array.from(container.querySelectorAll('[data-card-title]')).map((node) => node.textContent);
    expect(titles).toEqual(manifest.dashboards.flatMap((dashboard) => dashboard.widgets.map((entry) => entry.title)));
    for (const entry of manifest.dashboards[0].widgets.filter((candidate) => ['line', 'area', 'bar'].includes(candidate.kind))) {
      const result = expected.formulas.find((formula) => formula.formulaId === entry.formulaRef)!;
      const table = screen.getByRole('table', { name: `${entry.title} — data table` });
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(result.series.length);
      result.series.forEach((value, index) => {
        expect(within(rows[index]).getAllByRole('cell').map((cell) => cell.textContent))
          .toEqual([String(index), String(value)]);
      });
      expect(within(table).getByRole('columnheader', { name: `Value (${result.unit})` })).toBeInTheDocument();
    }
    expect(screen.getByText('Efficiency Starter Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/bundled synthetic sample data/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply|execute|run automation/i })).not.toBeInTheDocument();
  });

  it('keeps signed, zero and final chart samples, metric units, averages and the observed sample range', () => {
    runOverride = preparedRun();
    renderWithProviders(<SandboxPreviewPanel />);
    for (const title of ['Efficiency Gap vs Target', 'Battery Headroom', 'Charge Added']) {
      const rows = within(screen.getByRole('table', { name: `${title} — data table` })).getAllByRole('row').slice(1);
      expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent)))
        .toEqual([['0', '-12.5'], ['1', '0'], ['2', '7.25'], ['3', '15'], ['4', '23.5']]);
    }
    const metric = widget('Currently Below Target');
    expect(metric.getByText('23.50 flag')).toBeInTheDocument();
    expect(metric.getByText('avg 6.65 flag')).toBeInTheDocument();
    expect(screen.getByText('sample -12.50–23.50 %')).toBeInTheDocument();
    expect(screen.getByText('5 sample rows · 117 evaluation steps · 2ms')).toBeInTheDocument();
  });

  it('distinguishes a real zero result from an unsupported empty result without removing sibling widgets', () => {
    runOverride = preparedRun();
    const stat = runOverride.formulas.find((formula) => formula.formulaId === 'is-below-target')!;
    stat.series = [0, 0];
    stat.latest = 0;
    stat.average = 0;
    const chart = runOverride.formulas.find((formula) => formula.formulaId === 'efficiency-gap')!;
    chart.series = [];
    chart.latest = null;
    chart.average = null;
    chart.budgetError = 'Sandbox step budget exceeded';
    runOverride.truncated = true;
    renderWithProviders(<SandboxPreviewPanel />);

    expect(widget('Currently Below Target').getByText('0.00 flag')).toBeInTheDocument();
    expect(widget('Currently Below Target').getByText('avg 0.00 flag')).toBeInTheDocument();
    expect(widget('Efficiency Gap vs Target').getByText('No output rows.')).toBeInTheDocument();
    expect(widget('Efficiency Gap vs Target').getByText('Sandbox step budget exceeded')).toBeInTheDocument();
    expect(widget('Efficiency Gap vs Target').queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Charge Added — data table' })).toBeInTheDocument();
    expect(screen.getByText(/truncated by budget/i)).toBeInTheDocument();
  });

  it('updates metric precision and locale through the existing preference bridge without changing raw chart samples', () => {
    runOverride = preparedRun();
    renderWithProviders(<SandboxPreviewPanel />);
    const before = screen.getByRole('table', { name: 'Charge Added — data table' }).textContent;
    act(() => {
      setGlobalPrecision(3);
      setGlobalLocale('de-DE');
    });
    expect(widget('Currently Below Target').getByText('23,500 flag')).toBeInTheDocument();
    expect(widget('Currently Below Target').getByText('avg 6,650 flag')).toBeInTheDocument();
    expect(screen.getByText('sample -12,500–23,500 %')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Charge Added — data table' }).textContent).toBe(before);
  });

  it('does not replace denied synthetic zero with unknown or omit its capability-denial disclosure', () => {
    runOverride = preparedRun();
    const charge = runOverride.formulas.find((formula) => formula.formulaId === 'charge-added')!;
    charge.series = [0, 0, 0];
    charge.latest = 0;
    charge.average = 0;
    charge.deniedFieldRefs = ['charge_energy_added_kwh'];
    renderWithProviders(<SandboxPreviewPanel />);
    const table = screen.getByRole('table', { name: 'Charge Added — data table' });
    expect(within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[1].textContent))
      .toEqual(['0', '0', '0']);
    expect(widget('Charge Added').getByText('Fields evaluated as 0 (capability denied): charge_energy_added_kwh'))
      .toBeInTheDocument();
  });

  it('retains complete partial series and budget notices while a missing formula remains explicitly unsupported', () => {
    runOverride = preparedRun();
    runOverride.formulas = runOverride.formulas.filter((formula) => formula.formulaId !== 'is-below-target');
    runOverride.formulas[0].budgetError = 'Partial result retained';
    runOverride.truncated = true;
    renderWithProviders(<SandboxPreviewPanel />);
    expect(widget('Currently Below Target').getByText('Referenced formula not found.')).toBeInTheDocument();
    expect(widget('Efficiency Gap vs Target').getByText('Partial result retained')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Efficiency Gap vs Target — data table' })).getAllByRole('row'))
      .toHaveLength(6);
    expect(screen.getByText(/truncated by budget/i)).toBeInTheDocument();
  });

  it('retains the installed partial grant and complete preview results when the trust read fails its refresh', async () => {
    const repository = createInMemoryPackRepository();
    await installPack(repository, {
      envelope: EFFICIENCY_INSIGHTS_ENVELOPE,
      enabled: false,
      verification: {
        status: 'signature-valid',
        recomputedDigestSha256Hex: 'a'.repeat(64),
        recomputedPublisherFingerprint: manifest.publisher.fingerprint,
        claimedFingerprintMismatch: false,
        recognizedPublisherName: 'Snapshot publisher',
        summary: 'Retained install verification',
      },
    });
    await repository.putTrustDecision({
      packId: manifest.id,
      decision: 'trusted-signed-recognized',
      publisherFingerprint: manifest.publisher.fingerprint,
      decidedAtIso: '2026-10-01T10:00:00Z',
      approvedCapabilities: ['read:drive-sample', 'render:dashboard'],
    });
    const savedGrant = await repository.getTrustDecision(manifest.id);
    let resolveGrant!: (value: typeof savedGrant) => void;
    const pendingGrant = new Promise<typeof savedGrant>((resolve) => { resolveGrant = resolve; });
    const read = vi.spyOn(repository, 'getTrustDecision').mockReturnValueOnce(pendingGrant);
    const { client } = renderWithProviders(<SandboxPreviewPanel />, { repository });
    await screen.findByText('Installed pack: synthetic preview is simulating the full requested-capability grant because no installed grant is currently available.');
    expect(screen.queryByText('Preview mode: simulating full requested-capability grant (not installed)')).not.toBeInTheDocument();
    await act(async () => { resolveGrant(savedGrant); });
    await screen.findByText('Using installed capability grant');
    const before = screen.getByRole('table', { name: 'Charge Added — data table' }).textContent;
    expect(widget('Charge Added').getByText(/capability denied.*charge_energy_added_kwh/i)).toBeInTheDocument();
    read.mockRejectedValue(new Error('Trust refresh failed'));
    await act(async () => {
      await client.invalidateQueries({ queryKey: intelPackQueryKeys.trust(manifest.id) });
    });
    expect(client.getQueryState(intelPackQueryKeys.trust(manifest.id))?.status).toBe('error');
    expect(screen.getByText('Using installed capability grant')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Charge Added — data table' }).textContent).toBe(before);
    expect(widget('Charge Added').getByText(/capability denied.*charge_energy_added_kwh/i)).toBeInTheDocument();
    expect(screen.queryByText(/simulating full requested-capability grant/i)).not.toBeInTheDocument();
  });

  it('retains the synthetic charts and selected-pack controls through the real run-summary details drawer', () => {
    runOverride = preparedRun();
    renderWithProviders(<SandboxPreviewPanel />);
    const table = screen.getByRole('table', { name: 'Charge Added — data table' });
    const before = table.textContent;
    const select = screen.getByLabelText(/Pack to preview/i);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Selected pack evaluation details' });
    expect(within(drawer).getByText('5 sample rows · 117 evaluation steps · 2ms')).toBeInTheDocument();
    expect(within(drawer).getByText(/Local bounded interpreter over bundled synthetic sample data/i))
      .toHaveTextContent('Preview mode: simulating full requested-capability grant (not installed)');
    expect(within(drawer).getAllByText(/not a subscription or evidence of model accuracy/i)).toHaveLength(2);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(table.textContent).toBe(before);
    expect(select).toHaveValue(manifest.id);
    expect(widget('Currently Below Target').getByText('23.50 flag')).toBeInTheDocument();
  });

  it('keeps every recommendation field reviewable, in caller order, through trust-confirmation cancellation', async () => {
    const second = {
      id: 'second-recommendation',
      title: 'Second independently authored recommendation',
      rationale: 'Second rationale retained in full.',
      suggestedTriggerSummary: 'Second trigger summary.',
      suggestedConditionSummary: 'Second condition summary.',
      suggestedActionSummary: 'Second suggested action, not an executable command.',
    };
    const envelope = {
      ...EFFICIENCY_INSIGHTS_ENVELOPE,
      signature: null,
      contentDigestSha256Hex: undefined,
      manifest: {
        ...manifest,
        automationRecommendations: [...manifest.automationRecommendations, second],
      },
    };
    const onClose = vi.fn();
    const { repository } = renderWithProviders(
      <PackDetailModal entry={{ envelope, sourceNote: 'Test-only local draft', installedVersion: null, isUpToDate: false }}
        open onClose={onClose} />,
    );
    const recommendations = screen.getByRole('region', { name: 'Automation recommendations' });
    for (const entry of envelope.manifest.automationRecommendations) {
      for (const value of [entry.title, entry.rationale, entry.suggestedTriggerSummary, entry.suggestedConditionSummary, entry.suggestedActionSummary]) {
        expect(within(recommendations).getByText(value)).toBeInTheDocument();
      }
    }
    expect(recommendations.textContent!.indexOf(manifest.automationRecommendations[0].title))
      .toBeLessThan(recommendations.textContent!.indexOf(second.title));
    expect(screen.getByText(/2 automation recommendations \(suggestions only/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Trust as local-development pack/i }));
    expect(screen.getByRole('button', { name: 'Trust & install' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('region', { name: 'Automation recommendations' })).toHaveTextContent(second.suggestedActionSummary);
    expect(onClose).not.toHaveBeenCalled();
    expect(await repository.listInstalled()).toEqual([]);
    expect(await repository.getTrustDecision(envelope.manifest.id)).toBeNull();
  });
});
