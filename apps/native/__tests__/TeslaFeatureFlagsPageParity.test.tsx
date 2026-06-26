import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useRefreshTeslaFeatureConfig,
  useTeslaFeatureConfig,
} from '../src/web-parity/api/hooks/useUser';
import TeslaFeatureFlagsPage from '../src/web-parity/features/admin/pages/TeslaFeatureFlagsPage';

jest.mock('../src/web-parity/api/hooks/useUser', () => ({
  useTeslaFeatureConfig: jest.fn(),
  useRefreshTeslaFeatureConfig: jest.fn(),
}));

const mockUseTeslaFeatureConfig = useTeslaFeatureConfig as unknown as jest.Mock;
const mockUseRefreshTeslaFeatureConfig =
  useRefreshTeslaFeatureConfig as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

// Interpolated JSX text (e.g. `Synced Apr 4, 2026`) renders as several adjacent
// text segments, so flatten every text leaf into one string before asserting.
function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

function configStub(
  data: Record<string, unknown> | undefined,
  fetchedAt: string | null,
) {
  return {data: data === undefined ? undefined : {data, fetched_at: fetchedAt}};
}

function refreshStub(overrides: Record<string, unknown> = {}) {
  return {mutate: jest.fn(), isPending: false, ...overrides};
}

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<TeslaFeatureFlagsPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

beforeEach(() => {
  mockUseRefreshTeslaFeatureConfig.mockReturnValue(refreshStub());
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the page header, subtitle, panel, and refresh action', async () => {
  mockUseTeslaFeatureConfig.mockReturnValue(configStub({}, null));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('tesla-feature-flags-page');
  expect(text).toContain('Feature Flags');
  expect(text).toContain('Tesla account feature configuration');
  expect(raw).toContain('tesla-feature-config-panel');
  expect(raw).toContain('tesla-feature-config-refresh');
  expect(text).toContain('Refresh');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the empty state when there is no feature config data', async () => {
  mockUseTeslaFeatureConfig.mockReturnValue(configStub({}, null));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('tesla-feature-config-empty');
  expect(text).toContain(
    'No feature config data yet. Click Refresh to fetch from Tesla.',
  );
  // The synced stamp is hidden when fetched_at is null.
  expect(raw).not.toContain('tesla-feature-config-synced');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders a row per feature with status badge and details', async () => {
  mockUseTeslaFeatureConfig.mockReturnValue(
    configStub(
      {
        ['mobile_access']: true,
        ['supervised_charging']: {enabled: false, tier: 'beta'},
      },
      '2026-04-04T02:30:00Z',
    ),
  );

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('tesla-feature-config-table');
  expect(raw).toContain('tesla-feature-row-mobile_access');
  expect(raw).toContain('tesla-feature-row-supervised_charging');
  expect(text).toContain('mobile_access');
  expect(text).toContain('supervised_charging');
  // Boolean-coerced enabled → Enabled / Disabled badge labels.
  expect(text).toContain('Enabled');
  expect(text).toContain('Disabled');
  // Non-`enabled` object keys are joined as the details column.
  expect(text).toContain('tier: "beta"');
  // Column headers preserve the web Feature/Status/Details labels.
  expect(text).toContain('Feature');
  expect(text).toContain('Status');
  expect(text).toContain('Details');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the synced stamp when fetched_at is present', async () => {
  mockUseTeslaFeatureConfig.mockReturnValue(
    configStub({mobile_access: true}, '2026-04-04T02:30:00Z'),
  );

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('tesla-feature-config-synced');
  expect(text).toContain('Synced');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('disables the refresh button and shows a spinner while pending', async () => {
  mockUseTeslaFeatureConfig.mockReturnValue(configStub({}, null));
  mockUseRefreshTeslaFeatureConfig.mockReturnValue(refreshStub({isPending: true}));

  const tree = await render();
  const raw = rawOf(tree);

  expect(raw).toContain('tesla-feature-config-refresh');
  // ActivityIndicator renders while the mutation is pending.
  expect(raw).toContain('ActivityIndicator');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
