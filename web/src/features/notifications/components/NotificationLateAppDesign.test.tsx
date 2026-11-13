import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertRule, NotificationChannel, NotificationLog, PushSubscriptionRow, WebhookTestResult } from '@/api/types';
import { deriveDataState } from '@/api/dataState';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode, matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { AlertFatiguePanel } from './AlertFatiguePanel';
import { BrowserPushChannelCard } from './BrowserPushChannelCard';
import { ChannelCard } from './channels/ChannelCard';
import { ChannelProvidersPanel } from './channels/ChannelProvidersPanel';
import { NotificationBurnRatePanel } from './NotificationBurnRatePanel';
import { NotificationInboxDetails } from './NotificationInboxDetails';
import { NotificationRow } from './NotificationRow';
import { NotificationSoundChannelRow } from './NotificationSoundChannelRow';

const state = vi.hoisted(() => ({
  logs: [] as NotificationLog[],
  devices: [] as PushSubscriptionRow[],
  key: 'public-key' as string | undefined,
  keyError: null as Error | null,
  supported: true,
  error: null as Error | null,
  subscribe: vi.fn<() => Promise<boolean>>(),
  retry: vi.fn(),
  mutate: vi.fn(),
  webhook: vi.fn(),
}));
vi.mock('@/api/hooks/useNotifications', () => ({
  useNotificationAnalysisLogs: () => ({ data: state.logs, error: state.error, refetch: state.retry }),
  useNotificationDeliveryLogs: () => ({ data: state.logs, error: state.error, refetch: state.retry }),
  useToggleChannel: () => ({ mutate: state.mutate, isPending: false }),
  useDeleteChannel: () => ({ mutate: state.mutate, isPending: false }),
  useTestChannel: () => ({ mutate: state.mutate, isPending: false }),
}));
vi.mock('@/api/hooks/useNotificationChannels', () => ({
  useTestWebhookChannel: () => ({ mutate: state.webhook, isPending: false }),
}));
vi.mock('@/api/hooks/usePush', () => ({
  usePushPublicKey: () => ({
    data: state.key, error: state.keyError, isLoading: state.key === undefined && !state.keyError,
    refetch: state.retry,
  }),
  usePushSubscriptions: () => ({ data: state.devices, refetch: state.retry }),
  useUnsubscribePush: () => ({ mutateAsync: state.mutate, isPending: false }),
}));
vi.mock('@/hooks/useWebPush', () => ({
  useWebPush: () => ({
    isSupported: state.supported, isPushAPISupported: state.supported,
    browserSubscriptionStatus: 'absent', browserSubscriptionError: null,
    retryBrowserSubscription: state.retry, isSubscribed: false, currentEndpoint: null,
    permission: 'default', subscribe: state.subscribe, unsubscribe: state.subscribe,
  }),
}));
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ...(await import('@/test/chartTestDoubles')).chartTestDoubles,
}));

function css(file: string): Rule[] {
  const result: Rule[] = [];
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', file), 'utf8'))
    .walkRules(rule => { result.push(rule); });
  return result;
}
const identities = new Map(PACK_IDS.map(pack => [pack, css(join('packs', APP_DESIGN_PACK_FILES[pack]))]));
function expectIdentity(node: Element, pack: typeof PACK_IDS[number], part: string) {
  expect(identities.get(pack)!.some(rule => rule.selectors.some(selector =>
    selector.includes(`[data-app-part~="${part}"]`) && node.matches(selector)))).toBe(true);
}
function expectFeedback(node: Element, pack: typeof PACK_IDS[number], kind: string) {
  expect(matchesAppDesignCss(node, `[data-app-feedback-kind="${kind}"]`).some(match =>
    match.selector.includes(`[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`))).toBe(true);
}
function mount(children: ReactNode, pack: typeof PACK_IDS[number] = 'classic') {
  const view = render(<MemoryRouter><div data-app-design-preview="" {...getAppDesignAttributes(pack)}>{children}</div></MemoryRouter>);
  const host = view.container.firstElementChild!;
  const release = observeAppDesignScopes(host);
  return { ...view, host, release };
}
const channel: NotificationChannel = {
  id: 8, name: 'Source webhook', kind: 'webhook', enabled: true,
  url: 'https://receiver.example/private-token', method: 'PUT', headers: {},
  body_template: '', created_at: '', updated_at: '',
};
const rule: AlertRule = {
  id: 10, name: 'Source rule', enabled: false, signal_name: 'TpmsPressureFl', op: '<',
  value_num: 0, severity: 'info', cooldown_min: 60, trigger_mode: 'once', created_at: '', updated_at: '',
};
function log(id: number, status: NotificationLog['status'], severity: string): NotificationLog {
  return {
    id, channel_id: 8, alert_id: null, title: `Recorded ${severity} event`,
    message: 'Original\nmessage and source ordering', status, severity, error: '',
    created_at: new Date(Date.now() - id * 60_000).toISOString(), sent_at: null,
    latency_ms: 0,
  };
}
beforeEach(() => {
  state.logs = [log(1, 'sent', 'critical'), log(2, 'deferred_dnd', 'vendor/raw'), log(3, 'failed', 'warn')];
  state.devices = [{
    id: 7, user_id: 1, endpoint: 'https://push.example/device', p256dh: 'public', auth: 'auth',
    user_agent: 'Complete original device description', created_at: '', last_used_at: null,
  }];
  state.key = 'public-key';
  state.keyError = null;
  state.supported = true;
  state.error = null;
  state.subscribe.mockReset().mockResolvedValue(false);
  state.retry.mockReset();
  state.mutate.mockReset();
  state.webhook.mockReset();
});

describe('notifications-late-01 real source-to-consumer adoption (source-only)', () => {
  it.each(PACK_IDS)('%s owns independent records, definitions, controls and full fact bodies', pack => {
    const snapshot = JSON.stringify({ logs: state.logs, devices: state.devices, channel });
    const select = vi.fn();
    const activate = vi.fn();
    const preview = vi.fn();
    const toggle = vi.fn();
    const view = mount(<>
      <NotificationRow log={state.logs[0]} rule={rule} selected onSelectionChange={select} onActivate={activate} />
      <NotificationInboxDetails log={state.logs[0]} />
      <NotificationSoundChannelRow label="Complete channel label" enabled master={false} onToggle={toggle} onTest={preview} />
      <ChannelProvidersPanel channels={[channel]} />
      <ChannelCard channel={channel} onEdit={vi.fn()} />
      <BrowserPushChannelCard />
      <AlertFatiguePanel />
      <NotificationBurnRatePanel />
    </>, pack);
    try {
      const cards = view.host.querySelectorAll('[data-app-part~="card"][data-surface-variant="standalone"]');
      expect(cards).toHaveLength(16); // row, sound, seven providers, device, three rules, three severities
      for (const card of cards) expectIdentity(card, pack, 'card');
      const definitions = view.host.querySelectorAll('[data-app-list="definitions"]');
      expect(definitions).toHaveLength(2);
      for (const list of definitions) {
        expect(list.children.length).toBeGreaterThan(0);
        for (const row of list.children) {
          expectAppDesignDataMode(row, APPLICATION_DESIGNS[pack].data, '[data-app-list="definitions"]');
          expect(row.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
          const reading = row.querySelector('[data-app-part~="metric-reading"]')!;
          expectAppDesignDataMode(reading, APPLICATION_DESIGNS[pack].data, '[data-app-part~="metric-reading"]');
          expect(reading.querySelector('[data-app-part~="metric-value"]')).not.toBeEmptyDOMElement();
        }
      }
      expectIdentity(definitions[1], pack, 'panel');
      expect(screen.queryByText(channel.url)).not.toBeInTheDocument();
      expect(screen.getByText('••••••••')).toBeInTheDocument();
      expect(screen.getByText('0 ms')).toBeInTheDocument();
      const records = view.host.querySelectorAll('[data-app-card-kind="record"]');
      expect(records).toHaveLength(6);
      for (const record of records) {
        expectAppDesignDataMode(record, APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
        expectAppDesignDataMode(record.querySelector(':scope > [data-app-part~="record-header"]')!,
          APPLICATION_DESIGNS[pack].data, '[data-app-part~="record-header"]');
        expectAppDesignDataMode(record.querySelector(':scope > [data-app-part~="record-body"]')!,
          APPLICATION_DESIGNS[pack].data, '[data-app-part~="record-body"]');
      }
      const fatigue = screen.getByRole('region', { name: 'Alert fatigue' });
      const ruleTables = fatigue.querySelectorAll('[data-app-card-kind="record"] table');
      expect(ruleTables).toHaveLength(3);
      for (const table of ruleTables) expect(within(table as HTMLElement).getByText('Not tracked')).toBeInTheDocument();
      const row = screen.getByRole('group', { name: 'Recorded critical event' });
      const context = within(row).getByRole('link', { name: 'View context' });
      expectIdentity(context, pack, 'button');
      expect(context).toHaveAttribute('data-app-variant', 'ghost');
      expect(context.getAttribute('href')).toContain('/tire-pressure');
      expect(row).toHaveClass('data-[app-design-owner]:!border-l-2', 'data-[app-design-owner]:!border-l-[var(--text-secondary)]', 'data-[app-design-owner]:!bg-[var(--surface-2)]');
      expect(within(row).getByText('Critical').parentElement).toHaveClass('text-[var(--semantic-danger)]');
      fireEvent.click(within(row).getByRole('checkbox'));
      expect(select).toHaveBeenCalledExactlyOnceWith(1, false);
      expect(activate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Test Complete channel label sound' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Complete channel label' }));
      expect(preview).toHaveBeenCalledOnce();
      expect(toggle).toHaveBeenCalledExactlyOnceWith(false);
      expect(state.subscribe).not.toHaveBeenCalled();
      expect(state.webhook).not.toHaveBeenCalled();
      expect(JSON.stringify({ logs: state.logs, devices: state.devices, channel })).toBe(snapshot);
    } finally { view.release(); view.unmount(); }
  });

  it.each(PACK_IDS)('%s owns actual unsupported, loader, key-failure, action-failure and webhook feedback branches', async pack => {
    state.supported = false;
    let view = mount(<BrowserPushChannelCard />, pack);
    try {
      const notice = screen.getByText("This browser doesn't support notifications.").closest('[data-app-feedback-kind="notice"]')!;
      expectFeedback(notice, pack, 'notice');
      expect(notice.querySelector('[data-app-part~="feedback-icon"]')).not.toBeNull();
      expect(notice.querySelector('[data-app-part~="feedback-content"]')).not.toBeEmptyDOMElement();
    } finally { view.release(); view.unmount(); }

    state.supported = true;
    state.key = undefined;
    view = mount(<BrowserPushChannelCard />, pack);
    try {
      const loading = screen.getByTestId('webpush-loading');
      expect(loading).toHaveAttribute('data-app-feedback-kind', 'spinner');
      expectIdentity(loading, pack, 'loading');
      expect(loading.querySelector('svg')).toHaveClass('motion-reduce:animate-none');
      expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    } finally { view.release(); view.unmount(); }

    state.keyError = new Error('Key failed');
    view = mount(<BrowserPushChannelCard />, pack);
    try {
      expectFeedback(screen.getByRole('alert'), pack, 'error');
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(state.retry).toHaveBeenCalledOnce();
    } finally { view.release(); view.unmount(); }

    state.key = 'public-key';
    state.keyError = null;
    view = mount(<BrowserPushChannelCard />, pack);
    try {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enable on this device' })));
      const failure = screen.getByRole('alert');
      expectFeedback(failure, pack, 'error');
      expect(failure.querySelector('[data-app-part~="feedback-message"]')).not.toBeEmptyDOMElement();
      expect(state.subscribe).toHaveBeenCalledOnce();
      expect(screen.getByRole('button', { name: 'Enable on this device' })).toBeEnabled();
    } finally { view.release(); view.unmount(); }

    const result: WebhookTestResult = { success: false, status_code: 503, latency_ms: 0, signature: 'sha256=source', body_preview: 'Original response', error: 'Receiver failed' };
    state.webhook.mockImplementation((_input, callbacks: { onSuccess: (value: WebhookTestResult) => void }) => callbacks.onSuccess(result));
    view = mount(<ChannelCard channel={channel} onEdit={vi.fn()} />, pack);
    try {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      await act(async () => {});
      const feedback = screen.getByRole('status');
      expectFeedback(feedback, pack, 'notice');
      expect(feedback).toHaveTextContent('Status 503 · 0 ms');
      expect(feedback).toHaveTextContent('Receiver failed');
      expect(feedback).toHaveTextContent('sha256=source');
      expect(feedback).toHaveTextContent('Original response');
      expect(within(feedback).getByText('Failed')).toHaveClass('text-[var(--semantic-danger)]');
    } finally { view.release(); view.unmount(); }
  });

  it('keeps unknown provider counts and retained empty counts distinct without an app profile', () => {
    const view = mount(<ChannelProvidersPanel channels={[]} source={deriveDataState({ data: undefined })} />);
    view.release();
    view.host.removeAttribute('data-app-design-pack');
    expect(screen.getAllByText('Unknown')).toHaveLength(7);
    expect(screen.queryByText('Not configured')).not.toBeInTheDocument();
    view.rerender(<MemoryRouter><ChannelProvidersPanel channels={[]} source={deriveDataState({ data: [], error: new Error('Refresh failed') })} /></MemoryRouter>);
    expect(screen.getAllByText('Not configured')).toHaveLength(7);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(view.container.querySelector('[data-app-design-owner]')).toBeNull();
    for (const card of view.container.querySelectorAll('[data-app-part~="card"]')) expect(matchesAppDesignCss(card)).toEqual([]);
    view.unmount();
  });
});
