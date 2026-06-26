import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useAutomationHistory} from '../src/web-parity/api/hooks/useAutomations';
import AutomationHistoryWidget from '../src/web-parity/features/dashboard/widgets/AutomationHistoryWidget';

jest.mock('../src/web-parity/api/hooks/useAutomations', () => ({
  useAutomationHistory: jest.fn(),
}));

const mockUseAutomationHistory = useAutomationHistory as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

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

function run(
  id: number,
  name: string,
  status: string,
  durationMs: number | null,
  triggeredAt: string,
) {
  return {
    id,
    automation_id: id * 10,
    automation_name: name,
    vehicle_id: 1,
    triggered_at: triggeredAt,
    completed_at: null,
    duration_ms: durationMs,
    trigger_type: 'schedule',
    trigger_snapshot: null,
    conditions_met: true,
    conditions_snapshot: null,
    actions_executed: null,
    actions_total: 1,
    actions_succeeded: 1,
    actions_failed: 0,
    status,
    error: null,
    fsm_state: null,
    created_at: triggeredAt,
  };
}

const RECENT = new Date(Date.now() - 5 * 60_000).toISOString();
const OLDER = new Date(Date.now() - 90 * 60_000).toISOString();

function historyStub() {
  return {
    data: {
      items: [
        run(1, 'Nightly Charge', 'success', 1500, RECENT),
        run(2, 'Preheat Cabin', 'failed', 800, OLDER),
      ],
      total: 2,
      limit: 20,
      offset: 0,
      summary: {
        total_executions: 12,
        succeeded: 11,
        failed: 1,
        partial: 0,
        success_rate: 91.6,
        avg_duration_ms: 1200,
      },
    },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockUseAutomationHistory.mockReturnValue(historyStub());
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(
  element: React.ReactElement,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

async function unmount(tree: ReactTestRenderer.ReactTestRenderer): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
}

const WIDE = {cols: 2, rows: 3};
const COMPACT = {cols: 1, rows: 1};

test('renders a loading skeleton while history is loading', async () => {
  mockUseAutomationHistory.mockReturnValue({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<AutomationHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('automation-history-loading');
  expect(raw).not.toContain('automation-history-widget');

  await unmount(tree);
});

test('renders the wide layout with success rate, total runs, and the run feed', async () => {
  const tree = await render(<AutomationHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('automation-history-widget');
  expect(text).toContain('Automation History');

  // Success-rate badge (91.6 -> success variant) + total-run count.
  expect(raw).toContain('automation-history-success-rate');
  expect(text).toContain('91.6% Success Rate');
  expect(raw).toContain('automation-history-total-runs');
  expect(text).toContain('12 runs');

  // Event feed rows: automation names + "status · duration" subtitles.
  expect(raw).toContain('automation-history-feed');
  expect(text).toContain('Nightly Charge');
  expect(text).toContain('success \u00b7 1.5s');
  expect(text).toContain('Preheat Cabin');
  expect(text).toContain('failed \u00b7 800ms');

  // Freshness chip is wired.
  expect(raw).toContain('automation-history-freshness');

  await unmount(tree);
});

test('renders the wide empty feed state when there is no history', async () => {
  mockUseAutomationHistory.mockReturnValue({
    data: {items: [], total: 0, limit: 20, offset: 0, summary: null},
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<AutomationHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('automation-history-feed-empty');
  expect(text).toContain('No automation runs yet');

  await unmount(tree);
});

test('renders the compact layout with the success percentage and last-run time', async () => {
  const tree = await render(<AutomationHistoryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('automation-history-compact');
  expect(text).toContain('91.6%');
  expect(text).toContain('Success Rate');
  expect(raw).toContain('automation-history-compact-time');

  await unmount(tree);
});

test('renders the compact empty state when the fleet has no automation runs', async () => {
  mockUseAutomationHistory.mockReturnValue({
    data: {items: [], total: 0, limit: 20, offset: 0, summary: null},
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<AutomationHistoryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('automation-history-empty');
  expect(raw).not.toContain('automation-history-compact');
  expect(text).toContain('No automation runs yet');

  await unmount(tree);
});

test('reflects the error freshness state in the header chip', async () => {
  mockUseAutomationHistory.mockReturnValue({
    data: {items: [], total: 0, limit: 20, offset: 0, summary: null},
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: true,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<AutomationHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('automation-history-freshness-dot');
  expect(text).toContain('error');

  await unmount(tree);
});
