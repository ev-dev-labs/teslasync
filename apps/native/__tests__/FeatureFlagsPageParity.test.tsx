import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useDeleteFlag,
  useFlagChanges,
  useFlags,
  useSetFlag,
  type FeatureFlagChange,
  type FeatureFlagEntry,
} from '../src/web-parity/api/hooks/useFeatureFlags';
import FeatureFlagsPage from '../src/web-parity/features/admin/pages/FeatureFlagsPage';

jest.mock('../src/web-parity/api/hooks/useFeatureFlags', () => ({
  useFlags: jest.fn(),
  useFlagChanges: jest.fn(),
  useSetFlag: jest.fn(),
  useDeleteFlag: jest.fn(),
}));

const mockUseFlags = useFlags as unknown as jest.Mock;
const mockUseFlagChanges = useFlagChanges as unknown as jest.Mock;
const mockUseSetFlag = useSetFlag as unknown as jest.Mock;
const mockUseDeleteFlag = useDeleteFlag as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

// Interpolated JSX text (e.g. `Flag key ↑`) renders as several adjacent text
// segments, so flatten every text leaf into one string before asserting.
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

function mutationStub(overrides: Record<string, unknown> = {}) {
  return {mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false, ...overrides};
}

function flagsStub(flags: FeatureFlagEntry[] | undefined, isLoading: boolean) {
  return {
    data: flags ? {count: flags.length, flags} : undefined,
    isLoading,
    dataUpdatedAt: 0,
  };
}

function changesStub(rows: FeatureFlagChange[] | undefined, isLoading: boolean) {
  return {
    data: rows ? {count: rows.length, flag_key: '__all__', limit: 50, rows} : undefined,
    isLoading,
  };
}

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<FeatureFlagsPage />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

beforeEach(() => {
  mockUseSetFlag.mockReturnValue(mutationStub());
  mockUseDeleteFlag.mockReturnValue(mutationStub());
  mockUseFlagChanges.mockReturnValue(changesStub([], false));
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the page header, add action, and both panels', async () => {
  mockUseFlags.mockReturnValue(flagsStub([], false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('feature-flags-page');
  expect(text).toContain('Feature Flags');
  expect(text).toContain(
    'Typed feature-flag registry \u2014 all changes are sudo-gated and logged.',
  );
  expect(raw).toContain('feature-flags-add-button');
  expect(text).toContain('Add flag');
  expect(raw).toContain('flags-registry-panel');
  expect(raw).toContain('flags-changes-panel');
  expect(text).toContain('Registry');
  expect(text).toContain('Recent changes');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the empty registry + empty audit messages when there is no data', async () => {
  mockUseFlags.mockReturnValue(flagsStub([], false));
  mockUseFlagChanges.mockReturnValue(changesStub([], false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('flags-table-empty');
  expect(text).toContain('No feature flags are set on this server.');
  expect(raw).toContain('flags-changes-empty');
  expect(text).toContain('No flag changes yet');
  expect(text).toContain(
    'Flag changes will appear here once an operator edits a value.',
  );

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('shows the loading message in the registry while flags load', async () => {
  mockUseFlags.mockReturnValue(flagsStub(undefined, true));

  const tree = await render();
  const text = textOf(tree);

  expect(text).toContain('Loading flags\u2026');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders each flag row with its key, value preview, and row actions', async () => {
  const flags: FeatureFlagEntry[] = [
    {key: 'feature.dlq.replay_enabled', value: true},
    {key: 'feature.export.max_rows', value: 50000},
  ];
  mockUseFlags.mockReturnValue(flagsStub(flags, false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('flags-table');
  expect(raw).toContain('flag-row-feature.dlq.replay_enabled');
  expect(raw).toContain('flag-row-feature.export.max_rows');
  expect(text).toContain('feature.dlq.replay_enabled');
  // Boolean / number previews are stringified without extra quoting.
  expect(text).toContain('true');
  expect(text).toContain('50000');
  // Each row exposes both the edit and delete affordances.
  expect(raw).toContain('flag-edit-feature.dlq.replay_enabled');
  expect(raw).toContain('flag-delete-feature.dlq.replay_enabled');
  // Sortable key column header is present.
  expect(raw).toContain('flags-sort-key');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders the audit feed rows with operation, actor, and reason', async () => {
  const rows: FeatureFlagChange[] = [
    {
      id: 7,
      changed_at: '2026-04-04T02:30:00Z',
      actor: 'ops@teslasync.io',
      actor_ip: '10.0.0.1',
      flag_key: 'feature.dlq.replay_enabled',
      operation: 'set',
      old_value: false,
      new_value: true,
      reason: 'enable replay for incident triage',
      trace_id: 'trace-1',
    },
  ];
  mockUseFlagChanges.mockReturnValue(changesStub(rows, false));
  mockUseFlags.mockReturnValue(flagsStub([], false));

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('flag-changes-table');
  expect(raw).toContain('flag-change-row-7');
  expect(text).toContain('feature.dlq.replay_enabled');
  expect(text).toContain('ops@teslasync.io');
  expect(text).toContain('set');
  expect(text).toContain('enable replay for incident triage');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
