import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import {TOUSettingsModal} from '../src/web-parity/features/battery/components/TOUSettingsModal';

/**
 * Native parity contract for TOUSettingsModal.
 *
 * The web component is the Powerwall "Update Rate Plan" dialog: a two-tab editor
 * (Preset Tariff <Select> + live JSON preview, or a Custom JSON <Textarea>) that
 * resolves the active tab to a TOUSettingsPayload via getPayload(), POSTs it with
 * useUpdateTOUSettings({siteId, settings}), and on success refreshes the Tesla
 * site info + closes; submit surfaces inline validation errors and handleClose is
 * a no-op while pending. The native port keeps every piece of state + the
 * tab/parse/gating logic, swaps the DOM Modal/Select/Textarea/Button for native
 * primitives, and wires the same ported hooks. These tests render the modal
 * through a real QueryClient with the api-client request() mocked.
 */

jest.mock('../src/web-parity/api/client', () => {
  const actual = jest.requireActual('../src/web-parity/api/client');
  return {
    __esModule: true,
    ...actual,
    request: jest.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {request} = require('../src/web-parity/api/client') as {
  request: jest.Mock;
};

type Tree = ReactTestRenderer.ReactTestRenderer;

const PGE_OPTION = 'PG&E EV2-A — Pacific Gas & Electric';

function makeClient(): QueryClient {
  return new QueryClient({defaultOptions: {queries: {retry: false}}});
}

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await new Promise<void>(resolve => setImmediate(() => resolve()));
  });
}

async function renderModal(
  onClose: () => void,
): Promise<{tree: Tree; client: QueryClient}> {
  const client = makeClient();
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <QueryClientProvider client={client}>
        <TOUSettingsModal open onClose={onClose} siteId={42} />
      </QueryClientProvider>,
    );
  });
  await flush();
  return {tree, client};
}

async function teardown(tree: Tree, client: QueryClient): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
  client.clear();
  await flush();
}

function json(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

// Find an `accessibilityRole="button"` pressable that wraps the given text. The
// role filter skips the dialog title (whose only pressable ancestors are the
// backdrop / no-op panel) so the submit button — which shares the title's text —
// is matched unambiguously.
function actionButton(tree: Tree, text: string) {
  const matches = tree.root.findAll(n => n.props?.children === text);
  for (const node of matches) {
    let cur = node.parent;
    while (cur) {
      if (
        typeof cur.props?.onPress === 'function' &&
        cur.props?.accessibilityRole === 'button'
      ) {
        return cur;
      }
      cur = cur.parent;
    }
  }
  return undefined;
}

function tabPressable(tree: Tree, label: string) {
  return tree.root.find(
    n =>
      n.props?.accessibilityRole === 'tab' &&
      n.props?.accessibilityLabel === label,
  );
}

// The native Select trigger (a role="button" pressable carrying the field's
// accessibilityLabel) opens the option sheet Modal — whose options only mount
// once `visible` flips true, mirroring RN's "Modal renders null while hidden".
function selectTrigger(tree: Tree, label: string) {
  return tree.root.find(
    n =>
      n.props?.accessibilityRole === 'button' &&
      n.props?.accessibilityLabel === label,
  );
}

async function press(node: {props: {onPress?: () => void}}): Promise<void> {
  await ReactTestRenderer.act(async () => {
    node.props.onPress?.();
  });
  await flush();
}

async function selectPreset(tree: Tree, optionLabel: string): Promise<void> {
  await press(selectTrigger(tree, 'Rate Plan'));
  await press(actionButton(tree, optionLabel)!);
}

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({});
});

test('renders the title, description, both tabs, and the preset select', async () => {
  const {tree, client} = await renderModal(jest.fn());
  const body = json(tree);

  expect(body).toContain('Update Rate Plan');
  expect(body).toContain('optimize charging and discharging');
  expect(body).toContain('Preset Tariff');
  expect(body).toContain('Custom JSON');
  // Preset tab is active by default: the Rate Plan select + placeholder show.
  expect(body).toContain('Rate Plan');
  expect(body).toContain('Choose a rate plan');

  await teardown(tree, client);
});

test('submitting with no preset selected surfaces the "select a rate plan" error and skips the request', async () => {
  const onClose = jest.fn();
  const {tree, client} = await renderModal(onClose);

  await press(actionButton(tree, 'Update Rate Plan')!);

  expect(json(tree)).toContain('Please select a rate plan');
  expect(request).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  await teardown(tree, client);
});

test('selecting a preset renders the JSON preview of its tariff', async () => {
  const {tree, client} = await renderModal(jest.fn());

  await selectPreset(tree, PGE_OPTION);

  const body = json(tree);
  // Preview pre renders the stringified preset.settings.
  expect(body).toContain('Preview');
  expect(body).toContain('tou_settings');
  expect(body).toContain('economics');

  await teardown(tree, client);
});

test('custom tab with invalid JSON surfaces the parse error and skips the request', async () => {
  const onClose = jest.fn();
  const {tree, client} = await renderModal(onClose);

  // Switch to the Custom JSON tab, type invalid JSON, submit.
  await press(tabPressable(tree, 'Custom JSON'));
  const input = tree.root.findByProps({accessibilityLabel: 'TOU Settings JSON'});
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('not json');
  });
  await flush();

  await press(actionButton(tree, 'Update Rate Plan')!);

  expect(json(tree)).toContain('Invalid JSON');
  expect(request).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  await teardown(tree, client);
});

test('custom tab with an empty body surfaces the "enter the JSON" error', async () => {
  const {tree, client} = await renderModal(jest.fn());

  await press(tabPressable(tree, 'Custom JSON'));
  await press(actionButton(tree, 'Update Rate Plan')!);

  expect(json(tree)).toContain('Please enter the TOU settings JSON');
  expect(request).not.toHaveBeenCalled();

  await teardown(tree, client);
});

test('a selected preset submits via useUpdateTOUSettings({siteId,settings}), refreshes site info, and closes', async () => {
  const onClose = jest.fn();
  const {tree, client} = await renderModal(onClose);

  await selectPreset(tree, PGE_OPTION);
  await press(actionButton(tree, 'Update Rate Plan')!);

  // POST to the TOU-settings endpoint for the given siteId, with the preset body.
  const touCall = request.mock.calls.find(
    ([path]: [string]) =>
      typeof path === 'string' && path.includes('/tou-settings'),
  );
  expect(touCall).toBeDefined();
  expect(touCall?.[0]).toBe('/tesla/energy-sites/42/tou-settings');
  expect(touCall?.[1]?.method).toBe('POST');
  expect(String(touCall?.[1]?.body)).toContain('economics');

  // onSuccess fires the site-info refresh POST + closes.
  const refreshCall = request.mock.calls.find(
    ([path]: [string]) =>
      typeof path === 'string' && path.includes('/site-info/refresh'),
  );
  expect(refreshCall?.[0]).toBe('/tesla/energy-sites/42/site-info/refresh');
  expect(onClose).toHaveBeenCalledTimes(1);

  await teardown(tree, client);
});

test('Cancel calls onClose', async () => {
  const onClose = jest.fn();
  const {tree, client} = await renderModal(onClose);

  await press(actionButton(tree, 'Cancel')!);

  expect(onClose).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();

  await teardown(tree, client);
});
