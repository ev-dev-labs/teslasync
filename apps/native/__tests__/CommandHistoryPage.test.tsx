import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// The native commands/vehicles hooks are mocked so CommandHistoryPage resolves
// its queries synchronously without a QueryClientProvider, network, or open
// handles (the MileagePage / TeslaRegionPage mocking precedent). All referenced
// module variables are `mock`-prefixed so the jest.mock factories may close over
// them.
type Query<T> = {
  data?: T;
  isLoading?: boolean;
  error?: unknown;
};

type CommandLogEntry = {
  id: number;
  vehicle_id: number;
  command: string;
  params: string;
  status: string;
  error: string;
  created_at: string;
};

type Vehicle = {id: number; vehicle_id: number; vin: string; display_name: string};

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

let mockCommands: Query<CommandLogEntry[]> = {
  data: [
    {
      id: 1,
      vehicle_id: 7,
      command: 'lock',
      params: '{}',
      status: 'success',
      error: '',
      created_at: minutesAgo(5),
    },
    {
      id: 2,
      vehicle_id: 7,
      command: 'wake_up',
      params: '{}',
      status: 'failed',
      error: 'timeout',
      created_at: minutesAgo(120),
    },
  ],
  isLoading: false,
  error: null,
};

let mockVehicles: Query<Vehicle[]> = {
  data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
};

jest.mock('../src/web-parity/api/hooks/useCommands', () => ({
  useCommandHistory: () => mockCommands,
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: () => mockVehicles,
}));

import CommandHistoryPage from '../src/web-parity/features/system/pages/CommandHistoryPage';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function hasHost(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && node.props.testID === testID,
    ).length > 0
  );
}

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

afterEach(() => {
  mockCommands = {
    data: [
      {
        id: 1,
        vehicle_id: 7,
        command: 'lock',
        params: '{}',
        status: 'success',
        error: '',
        created_at: minutesAgo(5),
      },
      {
        id: 2,
        vehicle_id: 7,
        command: 'wake_up',
        params: '{}',
        status: 'failed',
        error: 'timeout',
        created_at: minutesAgo(120),
      },
    ],
    isLoading: false,
    error: null,
  };
  mockVehicles = {
    data: [{id: 7, vehicle_id: 7, vin: '5YJ3E1EA7KF000007', display_name: 'Bluey'}],
  };
  jest.restoreAllMocks();
});

/* ── scaffold + header ── */

test('renders the page scaffold with title, subtitle, and vehicle picker', () => {
  const tree = render(<CommandHistoryPage />);
  expect(hasHost(tree, 'command-history-page')).toBe(true);
  expect(hasHost(tree, 'command-history-vehicle-select')).toBe(true);
  expect(hasHost(tree, 'command-history-range')).toBe(true);
  expect(hasHost(tree, 'command-history-back-link')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Command History');
  expect(text).toContain('Audit log of all vehicle commands');
  expect(text).toContain('Bluey');
});

/* ── summary stat cards ── */

test('renders the four summary stat cards with derived values', () => {
  const tree = render(<CommandHistoryPage />);
  const text = allText(tree);
  expect(text).toContain('Commands (24h)');
  expect(text).toContain('Success Rate');
  expect(text).toContain('Most Used');
  expect(text).toContain('Last Sent');
  // 1 success of 2 commands → 50%.
  expect(text).toContain('50%');
});

/* ── filter bar ── */

test('renders the status tabs and the search box', () => {
  const tree = render(<CommandHistoryPage />);
  expect(hasHost(tree, 'command-history-tab-all')).toBe(true);
  expect(hasHost(tree, 'command-history-tab-success')).toBe(true);
  expect(hasHost(tree, 'command-history-tab-failed')).toBe(true);
  expect(hasHost(tree, 'command-history-search')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('All');
  expect(text).toContain('Success');
  expect(text).toContain('Failed');
});

/* ── command timeline ── */

test('renders the command timeline with formatted command names', () => {
  const tree = render(<CommandHistoryPage />);
  expect(hasHost(tree, 'timeline')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Command Timeline');
  expect(text).toContain('2 commands');
  // formatCommandName('lock') → 'Lock'; 'wake_up' → 'Wake Up'.
  expect(text).toContain('Lock');
  expect(text).toContain('Wake Up');
  // buildSubtitle surfaces the failed command's error.
  expect(text).toContain('Error: timeout');
});

/* ── empty state ── */

test('shows the no-commands empty state when history is empty', () => {
  mockCommands = {data: [], isLoading: false, error: null};
  const tree = render(<CommandHistoryPage />);
  expect(hasHost(tree, 'command-history-empty')).toBe(true);
  expect(hasHost(tree, 'timeline')).toBe(false);
  expect(allText(tree)).toContain('No commands have been sent yet');
});

/* ── loading state gates the body behind the spinner ── */

test('shows the loading spinner and hides the timeline while loading', () => {
  mockCommands = {data: undefined, isLoading: true, error: null};
  const tree = render(<CommandHistoryPage />);
  expect(hasHost(tree, 'command-history-loading')).toBe(true);
  // Body sections are gated behind the spinner, exactly like the web PageContainer.
  expect(allText(tree)).not.toContain('Command Timeline');
});

/* ── error state ── */

test('renders the error message when the history query errors', () => {
  mockCommands = {data: undefined, isLoading: false, error: new Error('boom')};
  const tree = render(<CommandHistoryPage />);
  expect(hasHost(tree, 'command-history-error')).toBe(true);
  expect(allText(tree)).toContain('boom');
});
