import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { parse, type Rule } from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackEntry } from '@/api/types';
import type { RedisSignalsMeta } from '@/api/devtools';
import type { DLQEntryFull } from '@/types/admin-diagnostics';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import RequestBuilder from './RequestBuilder';
import { RegexTesterTool } from './devtools/tools/RegexTester';
import { TimestampTool } from './devtools/tools/TimestampTool';
import { UnixPermissionTool } from './devtools/tools/UnixPermissionTool';
import { UrlEncoderTool } from './devtools/tools/UrlEncoder';
import { UuidGeneratorTool } from './devtools/tools/UuidGenerator';
import { VinDecoderTool } from './devtools/tools/VinDecoder';
import { EntryDrawer } from './dlq-inspector/EntryDrawer';
import { FeedbackExpansion } from './feedback-queue/FeedbackExpansion';
import { GDPRLookupPanel } from './gdpr-export/GDPRLookupPanel';
import { GDPRDownloadPanel } from './gdpr-export/GDPRDownloadPanel';
import { LiveSignalSourceBreakdown } from './live-signal-inspector/LiveSignalSourceBreakdown';
import { RedisDiagnosticEmptyState } from './RedisDiagnosticEmptyState';

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key)
        .replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const directory = resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs');
function rules(name: string): Rule[] {
  const result: Rule[] = [];
  parse(readFileSync(resolve(directory, name), 'utf8')).walkRules(rule => { result.push(rule); });
  return result;
}
const feedbackRules = rules('feedback.css');
const identityRules = new Map(PACK_IDS.map(pack => [pack, rules(join('packs', `${pack}.css`))]));
const initialAttributes = Object.keys(getAppDesignAttributes('classic'))
  .map(name => [name, document.documentElement.getAttribute(name)] as const);
const releases: Array<() => void> = [];
const clients: QueryClient[] = [];

const entry: DLQEntryFull = {
  id: 'synthetic-admin02', arrived_at: '2026-10-01T10:00:00Z',
  dlq_topic: 'dlq/synthetic', parsed_reason: 'synthetic', replayable: true,
  parsed_source_topic: 'telemetry/synthetic', raw_payload_size: 12, inner_payload_size: 14,
  inner_payload_b64: btoa('{"inner":true}'), raw_payload_b64: btoa('{"raw":true}'),
};
const feedback: FeedbackEntry = {
  id: 7, created_at: '2026-10-01T10:00:00Z', category: 'bug', title: 'Synthetic report',
  body: 'Full report\nwith preserved context', page_route: '/drives', app_version: '1.2.3',
  user_agent: 'Synthetic agent', user_email: '', submitter_subject: 'synthetic-subject',
  submitter_ip: '', recent_errors: { count: 0, message: '<literal>' },
  console_tail: 'ERROR synthetic\nWARN retained', status: 'new', github_issue_url: '',
  triaged_at: null, triaged_by: '',
};
const redisMeta: RedisSignalsMeta = {
  live_signal_store_mode: 'local', redis_key: 'vehicle:7:signals',
  redis_field_count: 0, l1_signal_count: 0, l1_last_seen_at: null,
  l2_last_seen_at: null, vehicle_vin: 'synthetic',
};
const endpoint = {
  method: 'DELETE' as const, path: '/synthetic/{id}', tag: 'Synthetic',
  summary: '', description: '', operationId: 'synthetic', responses: {},
  parameters: [
    { name: 'id', in: 'path' as const, required: true, type: 'string', description: '' },
    { name: 'query', in: 'query' as const, required: false, type: 'string', description: '' },
  ],
};

function expectConsumer(element: Element, candidates: Rule[], target: string) {
  expect(candidates.some(rule => rule.selector.includes(target)
    && rule.nodes.some(node => node.type === 'decl')
    && element.matches(rule.selector)), element.outerHTML).toBe(true);
}

afterEach(() => {
  cleanup();
  releases.splice(0).forEach(release => release());
  clients.splice(0).forEach(client => client.clear());
  for (const [name, value] of initialAttributes) {
    if (value === null) document.documentElement.removeAttribute(name);
    else document.documentElement.setAttribute(name, value);
  }
});

describe('admin-02 actual native targets to existing CSS consumers (source-only)', () => {
  it.each(PACK_IDS)('binds real opened outputs, records and controls for %s without changing actions or geometry', async pack => {
    const onSend = vi.fn();
    const onReplay = vi.fn();
    const onUpdate = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const view = render(<MemoryRouter><QueryClientProvider client={client}>
      <RequestBuilder endpoint={endpoint} loading={false} onSend={onSend} />
      <RegexTesterTool />
      <TimestampTool />
      <UnixPermissionTool />
      <UrlEncoderTool />
      <UuidGeneratorTool />
      <VinDecoderTool />
      <EntryDrawer open summary={entry} full={entry} loading={false} replayEnabled
        replayInFlight={false} onClose={vi.fn()} onReplay={onReplay} />
      <FeedbackExpansion row={feedback} bridgeEnabled onUpdate={onUpdate}
        updating={false} canStart={false} />
      <GDPRLookupPanel idInput="" onIdChange={vi.fn()} onLookup={vi.fn()} />
      <GDPRDownloadPanel downloadUrl="/synthetic-download" />
      <LiveSignalSourceBreakdown stats={{
        total: 10, live: 5, stale: 3, legacy: 2, numeric: 0, freshestAgeMs: null,
        bySource: { l1: 5, stale: 3, l2: 2, unknown: 0 }, byKind: [],
      }} status="ready" error={null} onRetry={vi.fn()} />
      <RedisDiagnosticEmptyState vehicleId={7} meta={redisMeta} onSelectVehicle={vi.fn()} />
    </QueryClientProvider></MemoryRouter>);

    fireEvent.change(screen.getByLabelText(/^id/), { target: { value: 'a/b' } });
    fireEvent.change(screen.getByLabelText('query'), { target: { value: 'a b&c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: 'a*' } });
    fireEvent.change(screen.getByLabelText('Test string'), { target: { value: 'baa' } });
    fireEvent.change(screen.getByLabelText('Input label'), { target: { value: 'a b&c' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    fireEvent.change(screen.getByLabelText('VIN'), { target: { value: '5YJ3E1EA1NF' } });
    const errorsDisclosure = screen.getByText('Recent frontend errors').closest('details')!;
    const consoleDisclosure = screen.getByText('Console tail').closest('details')!;
    fireEvent.click(within(errorsDisclosure).getByText('Recent frontend errors'));
    fireEvent.click(within(consoleDisclosure).getByText('Console tail'));
    expect(errorsDisclosure).toHaveAttribute('open');
    expect(consoleDisclosure).toHaveAttribute('open');

    for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) {
      document.documentElement.setAttribute(name, value);
    }
    releases.push(observeAppDesignScopes(document.documentElement));
    const packRules = identityRules.get(pack)!;

    const url = screen.getByText('/api/v1/synthetic/a%2Fb?query=a%20b%26c');
    expect(url.tagName).toBe('CODE');
    expect(url).toHaveClass('overflow-x-auto', 'whitespace-nowrap');
    const permissionCode = screen.getByText('rwxr-xr-x', { selector: 'code' });
    const encoded = screen.getByText('a%20b%26c', { selector: 'pre' });
    const generated = within(screen.getByRole('list', { name: 'Generated UUIDs' })).getByRole('listitem');
    const report = screen.getByText('Full report with preserved context').closest('[data-app-part~="panel"]')!;
    const guidance = screen.getByText(/A saved manifest does not confirm/).closest('[data-app-part~="panel"]')!;
    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panels).toHaveLength(2);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('{"inner":true}');
    for (const surface of [
      url, permissionCode.parentElement!, encoded.parentElement!, generated, report, guidance,
      screen.getByRole('group', { name: 'Current time' }), ...panels,
      errorsDisclosure.querySelector('pre')!, consoleDisclosure.querySelector('pre')!,
    ]) {
      expect(surface).toHaveAttribute('data-app-part', expect.stringContaining('panel'));
      expect(surface).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
      expectConsumer(surface, packRules, '[data-app-part~="panel"]');
    }
    for (const frame of [
      url, permissionCode.parentElement!, encoded.parentElement!, generated,
      screen.getByRole('group', { name: 'Current time' }), ...panels,
      errorsDisclosure.querySelector('pre')!, consoleDisclosure.querySelector('pre')!,
    ]) {
      expect(frame).toHaveAttribute('data-app-panel-kind', 'code');
      expectConsumer(frame, feedbackRules, '[data-app-panel-kind="code"]');
      const body = frame.hasAttribute('data-app-code-slot')
        ? frame : frame.querySelector('[data-app-code-slot="body"]')!;
      expect(body).toHaveAttribute('data-app-code-slot', 'body');
      expectConsumer(body, feedbackRules, '[data-app-code-slot="body"]');
      for (const slot of frame.querySelectorAll('[data-app-code-slot="heading"], [data-app-code-slot="actions"]')) {
        expectConsumer(slot, feedbackRules, `[data-app-code-slot="${slot.getAttribute('data-app-code-slot')}"]`);
      }
    }
    expect(report).toHaveAttribute('data-app-card-kind', 'record');
    expectConsumer(report, feedbackRules, '[data-app-card-kind="record"]');
    const reportBody = report.querySelector('[data-app-part~="record-body"]')!;
    expectConsumer(reportBody, feedbackRules, '[data-app-part~="record-body"]');
    expect(reportBody).toHaveTextContent('Full report with preserved context');
    expect(guidance).toHaveAttribute('data-app-feedback-kind', 'notice');
    expect(guidance).toHaveAttribute('data-app-tone', 'info');
    expectConsumer(guidance, feedbackRules, '[data-app-feedback-kind="notice"]');
    for (const part of ['feedback-icon', 'feedback-content', 'feedback-message']) {
      expectConsumer(guidance.querySelector(`[data-app-part~="${part}"]`)!, feedbackRules, `[data-app-part~="${part}"]`);
    }
    expect(errorsDisclosure.querySelector('pre')?.textContent).toBe(JSON.stringify(feedback.recent_errors, null, 2));
    expect(consoleDisclosure.querySelector('pre')?.textContent).toBe(feedback.console_tail);
    expect(screen.getByText('Serial').nextElementSibling).toHaveTextContent('—');
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);

    for (const list of view.container.querySelectorAll('[data-app-list="definitions"], [data-app-list="ranked"]')) {
      const rows = list.querySelectorAll(':scope > [data-app-part~="list-row"]');
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expectConsumer(row, feedbackRules, `[data-app-list="${list.getAttribute('data-app-list')}"]`);
        expect(row.querySelector('[data-app-part~="metric-label"]')).not.toBeNull();
        expect(row.querySelector('[data-app-part~="metric-value"]')).not.toBeNull();
      }
    }
    expect(screen.getAllByText('(empty match)')).toHaveLength(2);
    const tiles = view.container.querySelectorAll('[data-app-metric="tile"]');
    expect(tiles).toHaveLength(4);
    expect([...tiles].map(tile => tile.querySelector('[data-app-part~="metric-value"]')?.textContent))
      .toEqual(['5', '3', '2', '0']);
    for (const tile of tiles) {
      expectConsumer(tile, feedbackRules, '[data-app-metric="tile"]');
      expectConsumer(tile, packRules, '[data-app-part~="metric"]');
      expect(tile.querySelector('[data-app-part~="metric-reading"] > [data-app-part~="metric-value"]')).not.toBeNull();
      expect(tile.querySelector('[data-app-part~="metric-label"]')).not.toBeNull();
      expect(tile.querySelector('[data-app-part~="metric-context"]')).not.toBeNull();
    }
    const bar = screen.getByRole('img', { name: /Signal source-layer distribution/ });
    expect(bar).toHaveAttribute('data-app-part', 'metric');
    expect(bar).toHaveAttribute('data-app-metric', 'bar');
    expect(bar).toHaveAttribute('data-metric-track');
    for (const segment of bar.children) {
      expect(segment).toHaveAttribute('data-metric-fill');
      expect(segment).not.toHaveAttribute('data-app-part');
    }
    expect([...bar.children].map(segment => (segment as HTMLElement).style.width)).toEqual(['50%', '30%', '20%']);
    expect(bar.children[0]).toHaveClass('bg-emerald-500');
    expect(bar.children[1]).toHaveClass('bg-amber-500');
    expect(bar.children[2]).toHaveClass('bg-theme-accent');

    expectConsumer(screen.getByText('DELETE'), packRules, '[data-app-part~="badge"]');
    for (const link of [
      screen.getByRole('link', { name: 'Download bundle' }),
      screen.getByRole('link', { name: 'See live-state contract docs' }),
    ]) {
      expect(link.tagName).toBe('A');
      expectConsumer(link, packRules, '[data-app-part~="button"]');
    }
    expect(screen.getByRole('link', { name: 'Download bundle' })).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'See live-state contract docs' })).toHaveAttribute('target', '_blank');
    const confirmation = screen.getByRole('alert');
    expectConsumer(confirmation, feedbackRules, '[data-app-feedback-kind="notice"]');
    expect(confirmation).toHaveAttribute('data-app-tone', 'warning');
    for (const part of ['feedback-icon', 'feedback-content', 'feedback-actions']) {
      const slot = confirmation.querySelector(`[data-app-part~="${part}"]`)!;
      expectConsumer(slot, feedbackRules, `[data-app-part~="${part}"]`);
    }
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(onReplay).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Status')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Pattern'), { target: { value: '[' } });
    const invalid = screen.getByText('Invalid regular expression').closest('[role="alert"]')!;
    await waitFor(() => expect(invalid).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`)));
    expectConsumer(invalid, feedbackRules, '[data-app-feedback-kind="notice"]');
    expect(invalid).toHaveAttribute('data-app-tone', 'danger');
    expect(invalid.querySelector('code[data-app-part="feedback-message"]'))
      .toHaveTextContent(/Invalid regular expression/i);
    expect(screen.getByLabelText('Pattern')).toHaveAttribute('aria-invalid', 'true');
  });

  it('leaves default/widget-only native readouts outside complete-profile consumers', () => {
    for (const [name] of initialAttributes) document.documentElement.removeAttribute(name);
    render(<RequestBuilder endpoint={endpoint} loading={false} onSend={vi.fn()} />);
    releases.push(observeAppDesignScopes(document.documentElement));
    const url = screen.getByText('/api/v1/synthetic/{id}');
    expect(url).not.toHaveAttribute('data-app-design-owner');
    expect(identityRules.get('terminal')!.some(rule =>
      rule.selector.includes('[data-app-part~="panel"]') && url.matches(rule.selector))).toBe(false);
  });

  it.each(PACK_IDS)('keeps source-shaped loading and guarded actions under %s', pack => {
    for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) {
      document.documentElement.setAttribute(name, value);
    }
    const onReplay = vi.fn();
    const view = render(<>
      <EntryDrawer open summary={entry} full={undefined} loading replayEnabled
        replayInFlight={false} onClose={vi.fn()} onReplay={onReplay} />
      <GDPRDownloadPanel downloadUrl="/synthetic-download" loading />
    </>);
    releases.push(observeAppDesignScopes(document.documentElement));
    const pending = screen.getByRole('status', { name: 'Loading payload details…' });
    expect(pending).toHaveAttribute('aria-busy', 'true');
    const detailShapes = pending.querySelectorAll('[data-app-part~="skeleton"]');
    expect(detailShapes).toHaveLength(2);
    expect(detailShapes[0]).toHaveClass('h-9', 'w-48');
    expect(detailShapes[1]).toHaveClass('h-48', 'w-full');
    const download = within(view.container).getByRole('heading', { name: 'Download' }).parentElement!;
    expect(download).toHaveAttribute('aria-busy', 'true');
    const downloadShapes = download.querySelectorAll('[data-app-part~="skeleton"]');
    expect(downloadShapes).toHaveLength(2);
    expect(downloadShapes[0]).toHaveStyle({ width: '90%', height: '14px' });
    expect(downloadShapes[1]).toHaveStyle({ width: '55%', height: '44px' });
    for (const shape of [...detailShapes, ...downloadShapes]) {
      expect(shape).toHaveAttribute('aria-hidden', 'true');
      expect(shape).toBeEmptyDOMElement();
      expectConsumer(shape, feedbackRules, '[data-app-part~="skeleton"]');
      expectConsumer(shape, identityRules.get(pack)!, '[data-app-part~="skeleton"]');
    }
    expect(screen.queryByRole('tabpanel', { hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Download bundle' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(onReplay).not.toHaveBeenCalled();
  });
});
