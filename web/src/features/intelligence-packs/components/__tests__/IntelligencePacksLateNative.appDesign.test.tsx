import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import {
  expectAppDesignDataMode, matchesAppDesignCss, matchingAppDesignDataRules,
  setAppDesignTestProfile,
} from '@/components/feedback/appDesignCss.test-utils';
import { APPLICATION_DESIGNS, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { CapabilityRequestList } from '../CapabilityRequestList';
import { ImportExportPanel } from '../ImportExportPanel';
import { SandboxPreviewPanel } from '../SandboxPreviewPanel';
import { COMMUNITY_DRAFT_ENVELOPE, EFFICIENCY_INSIGHTS_ENVELOPE } from '../../lib/catalogFixtures';
import { PACK_CAPABILITY_CATALOG, type PackCapabilityId } from '../../lib/manifestTypes';
import { createInMemoryPackRepository } from '../../lib/packRepository';
import { installPack } from '../../lib/packActions';
import * as importExport from '../../lib/manifestImportExport';
import { runSandboxPreview, type SandboxRunResult } from '../../lib/sandboxRunner';
import { renderWithProviders } from './testUtils';

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

afterEach(() => {
  runOverride = undefined;
  vi.restoreAllMocks();
});

async function installedDraft(envelope = COMMUNITY_DRAFT_ENVELOPE) {
  const repository = createInMemoryPackRepository();
  await installPack(repository, {
    envelope,
    enabled: false,
    verification: {
      status: 'unsigned',
      recomputedDigestSha256Hex: 'b'.repeat(64),
      recomputedPublisherFingerprint: null,
      claimedFingerprintMismatch: false,
      recognizedPublisherName: null,
      summary: 'Unsigned test draft',
    },
  });
  return repository;
}

function statCard(container: HTMLElement) {
  const title = within(container).getByText('Currently Below Target', { selector: '[data-card-title]' });
  const card = title.closest('[data-card]');
  if (!(card instanceof HTMLElement)) throw new Error('Missing actual stat widget');
  return card;
}

describe('intelligence-pack native records and synthetic stat ownership', () => {
  it('activates the actual capability rows, export record and stat anatomy for every complete app profile', async () => {
    const repository = await installedDraft();
    const capability = PACK_CAPABILITY_CATALOG[0];
    const view = renderWithProviders(
      <MemoryRouter>
        <div data-app-design-preview>
          <CapabilityRequestList capabilityIds={[capability.id, 'render:dashboard']} granted={new Set([capability.id])} />
          <ImportExportPanel />
          <SandboxPreviewPanel />
        </div>
      </MemoryRouter>,
      { repository },
    );
    const host = view.container.querySelector('[data-app-design-preview]')!;
    const exportButton = await screen.findByRole('button', { name: 'Export' });
    const record = exportButton.closest('[data-app-card-kind="record"]')!;
    const capabilityList = host.querySelector('[data-app-list="definitions"]')!;
    const rows = [...capabilityList.children];
    const stat = statCard(view.container).querySelector('[data-app-metric="tile"]')!;
    const expectedReading = stat.textContent;
    const release = observeAppDesignScopes(host);
    try {
      for (const node of [record, ...rows, stat]) {
        expect(node).not.toHaveAttribute('data-app-design-owner');
        expect(matchingAppDesignDataRules(node)).toHaveLength(0);
      }
      for (const pack of PACK_IDS) {
        setAppDesignTestProfile(host, pack);
        await waitFor(() => expect(stat).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`)));
        const mode = APPLICATION_DESIGNS[pack].data;
        expectAppDesignDataMode(record.parentElement!, mode, '[data-app-list="records"]');
        expectAppDesignDataMode(record, mode, '[data-app-card-kind="record"]');
        expectAppDesignDataMode(record.querySelector('[data-app-part="record-header"]')!, mode, '[data-app-part~="record-header"]');
        expectAppDesignDataMode(record.querySelector('[data-app-part="record-title"]')!, mode, '[data-app-part~="record-title"]');
        for (const row of rows) {
          expectAppDesignDataMode(row, mode, '[data-app-list="definitions"]');
          expectAppDesignDataMode(row.querySelector('[data-app-part~="metric-reading"]')!, mode, '[data-app-list="definitions"]');
        }
        expectAppDesignDataMode(stat, mode, '[data-app-metric="tile"]');
        const reading = stat.querySelector('[data-app-part="metric-reading"]')!;
        expect(matchesAppDesignCss(reading, '[data-app-part~="metric-reading"]').length).toBeGreaterThan(0);
        if (mode !== 'cards') expectAppDesignDataMode(reading, mode, '[data-app-metric="tile"]');
        for (const part of ['metric-value', 'metric-unit', 'metric-label', 'metric-context']) {
          expect(matchesAppDesignCss(stat.querySelector(`[data-app-part="${part}"]`)!, `[data-app-part~="${part}"]`).length)
            .toBeGreaterThan(0);
        }
        expect(stat.textContent).toBe(expectedReading);
        expect(record).toHaveTextContent(`${COMMUNITY_DRAFT_ENVELOPE.manifest.name} · v${COMMUNITY_DRAFT_ENVELOPE.manifest.version}`);
        expect(rows[0]).toHaveTextContent(capability.description);
        expect(within(rows[0] as HTMLElement).getByText('Granted')).toHaveAttribute('data-app-variant', 'success');
        expect(within(rows[1] as HTMLElement).getByText('Denied')).toHaveAttribute('data-app-variant', 'neutral');
        expect(exportButton).toBeEnabled();
        expect(stat.querySelector('[role="progressbar"], [role="meter"], svg')).toBeNull();
      }
      host.removeAttribute('data-app-design-pack');
      host.setAttribute('data-design-pack', 'cyber');
      await waitFor(() => expect(stat).not.toHaveAttribute('data-app-design-owner'));
      expect(matchingAppDesignDataRules(record)).toHaveLength(0);
      expect(matchingAppDesignDataRules(rows[0])).toHaveLength(0);
      expect(matchingAppDesignDataRules(stat)).toHaveLength(0);
    } finally {
      release();
    }
  });

  it('preserves requested versus granted capabilities, unknown identities and the empty-list contract', () => {
    const known = PACK_CAPABILITY_CATALOG[0];
    const unknown = 'future:capability-with-a-complete-technical-identifier' as PackCapabilityId;
    const view = renderWithProviders(<CapabilityRequestList capabilityIds={[known.id, unknown]} className="source-list" />);
    const list = screen.getByRole('list');
    expect(list).toHaveClass('source-list');
    expect(within(list).getAllByRole('listitem').map(row => row.textContent))
      .toEqual([`${known.label}${known.description}`, unknown]);
    expect(screen.queryByText('Granted')).not.toBeInTheDocument();
    expect(screen.queryByText('Denied')).not.toBeInTheDocument();
    view.rerender(<CapabilityRequestList capabilityIds={[known.id, unknown]} granted={new Set([known.id])} className="source-list" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Granted');
    expect(rows[1]).toHaveTextContent(unknown);
    expect(rows[1]).toHaveTextContent('Denied');
    view.rerender(<CapabilityRequestList capabilityIds={[]} className="source-list" />);
    expect(screen.getByText('This pack requests no capabilities.')).toHaveClass('source-list');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('exports the unchanged complete local envelope from its long native record without granting or installing anything else', async () => {
    const envelope = {
      ...COMMUNITY_DRAFT_ENVELOPE,
      manifest: {
        ...COMMUNITY_DRAFT_ENVELOPE.manifest,
        name: `Complete locally authored pack ${'retained-identifier-'.repeat(12)}`,
        version: `1.0.0-${'complete-version-'.repeat(8)}`,
      },
    };
    const repository = await installedDraft(envelope);
    const download = vi.spyOn(importExport, 'downloadEnvelope').mockImplementation(() => {});
    renderWithProviders(<ImportExportPanel />, { repository });
    const button = await screen.findByRole('button', { name: 'Export' });
    const record = button.closest('[data-app-card-kind="record"]')!;
    const title = record.querySelector('[data-app-part="record-title"]')!;
    expect(title.textContent).toBe(`${envelope.manifest.name} · v${envelope.manifest.version}`);
    expect(title).not.toHaveClass('truncate');
    fireEvent.click(button);
    expect(download).toHaveBeenCalledExactlyOnceWith(envelope);
    expect((await repository.listInstalled()).map(entry => entry.envelope)).toEqual([envelope]);
    expect(await repository.getTrustDecision(envelope.manifest.id)).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    { latest: 0, average: 0, unit: 'flag', value: '0.00', averageText: 'avg 0.00 flag', state: 'value' },
    { latest: null, average: null, unit: 'flag', value: '—', averageText: 'avg — flag', state: 'missing' },
    { latest: Number.NaN, average: null, unit: 'flag', value: '—', averageText: 'avg — flag', state: 'missing' },
    { latest: 2, average: null, unit: undefined, value: '2.00', averageText: 'avg —', state: 'value' },
    { latest: -1.25, average: -0.5, unit: 'flag', value: '-1.25', averageText: 'avg -0.50 flag', state: 'value' },
  ])('keeps $state latest $value distinct from its average and untouched source unit', ({ latest, average, unit, value, averageText, state }) => {
    const manifest = EFFICIENCY_INSIGHTS_ENVELOPE.manifest;
    runOverride = runSandboxPreview(manifest, new Set(manifest.capabilities));
    const formula = runOverride.formulas.find(entry => entry.formulaId === 'is-below-target')!;
    Object.assign(formula, { series: [0], latest, average, unit, budgetError: 'Retained partial synthetic result', deniedFieldRefs: ['drive_efficiency_wh_per_km'] });
    const view = renderWithProviders(<MemoryRouter><SandboxPreviewPanel /></MemoryRouter>);
    const card = statCard(view.container);
    const metric = card.querySelector('[data-app-metric="tile"]')!;
    expect(metric).toHaveAttribute('data-app-state', state);
    expect(metric.querySelector('[data-app-part="metric-value"]')?.textContent).toBe(value);
    expect(metric.querySelector('[data-app-part="metric-unit"]')?.textContent ?? null)
      .toBe(state === 'value' && unit ? unit : null);
    expect(metric.querySelector('[data-app-part="metric-label"]')).toHaveTextContent('Latest');
    expect(metric.querySelector('[data-app-part="metric-context"]')).toHaveTextContent(averageText);
    expect(within(card).getByText('Retained partial synthetic result')).toBeInTheDocument();
    expect(within(card).getByText('Fields evaluated as 0 (capability denied): drive_efficiency_wh_per_km')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Charge Added — data table' })).toBeInTheDocument();
  });
});
