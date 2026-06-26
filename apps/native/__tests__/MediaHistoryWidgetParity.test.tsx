import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import {useMediaHistory} from '../src/web-parity/api/hooks/useVehicleSystems';
import MediaHistoryWidget from '../src/web-parity/features/dashboard/widgets/MediaHistoryWidget';

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

jest.mock('../src/web-parity/api/hooks/useVehicleSystems', () => ({
  useMediaHistory: jest.fn(),
}));

const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseMediaHistory = useMediaHistory as unknown as jest.Mock;

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

function track(
  id: string,
  title: string,
  artist: string,
  source: string,
  playbackStatus: string,
  timestamp: string,
) {
  return {
    id,
    vehicleId: '1',
    title,
    artist,
    album: '',
    station: '',
    source,
    playbackStatus,
    volume: 5,
    volumeMax: 11,
    elapsed: 30,
    duration: 240,
    timestamp,
  };
}

const RECENT = new Date(Date.now() - 5 * 60_000).toISOString();
const OLDER = new Date(Date.now() - 90 * 60_000).toISOString();

function historyStub() {
  return {
    data: [
      track('t1', 'Bohemian Rhapsody', 'Queen', 'spotify', 'Playing', RECENT),
      track('t2', 'Thunderstruck', 'AC/DC', 'usb', 'Paused', OLDER),
    ],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({data: [{id: 1}]});
  mockUseMediaHistory.mockReturnValue(historyStub());
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
const COMPACT = {cols: 1, rows: 2};

test('renders a loading skeleton while history is loading', async () => {
  mockUseMediaHistory.mockReturnValue({
    data: undefined,
    isLoading: true,
    isFetching: true,
    isStale: false,
    isError: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<MediaHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('media-history-loading');
  expect(raw).not.toContain('media-history-widget');

  await unmount(tree);
});

test('renders the wide layout with the track feed and source labels', async () => {
  const tree = await render(<MediaHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('media-history-widget');
  expect(text).toContain('Media History');

  // Event feed rows: emoji-prefixed "Title — Artist" titles.
  expect(raw).toContain('media-history-feed');
  expect(raw).toContain('media-track-t1');
  expect(text).toContain('Bohemian Rhapsody \u2014 Queen');
  expect(text).toContain('Thunderstruck \u2014 AC/DC');

  // sourceLabel: "spotify" -> "Spotify", "usb" -> "USB".
  expect(text).toContain('Spotify');
  expect(text).toContain('USB');

  // Freshness chip is wired.
  expect(raw).toContain('media-history-freshness');

  await unmount(tree);
});

test('renders the wide empty feed state when there is no history', async () => {
  mockUseMediaHistory.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<MediaHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('media-history-feed-empty');
  expect(text).toContain('No tracks played');

  await unmount(tree);
});

test('renders the compact layout with the last track title and artist', async () => {
  const tree = await render(<MediaHistoryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('media-history-compact');
  expect(text).toContain('Bohemian Rhapsody \u2014 Queen');

  await unmount(tree);
});

test('renders "No tracks played" in compact view when the last track has no title', async () => {
  mockUseMediaHistory.mockReturnValue({
    data: [track('t9', '\u2014', '\u2014', '', 'Idle', RECENT)],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<MediaHistoryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('media-history-compact');
  expect(text).toContain('No tracks played');

  await unmount(tree);
});

test('renders the compact empty state when there is no media history', async () => {
  mockUseMediaHistory.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<MediaHistoryWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('media-history-empty');
  expect(raw).not.toContain('media-history-compact');
  expect(text).toContain('No tracks played');

  await unmount(tree);
});

test('falls back to the first vehicle id when no vehicleId prop is supplied', async () => {
  const tree = await render(<MediaHistoryWidget size={WIDE} />);

  expect(mockUseMediaHistory).toHaveBeenCalledWith('1');

  await unmount(tree);
});

test('reflects the error freshness state in the header chip', async () => {
  mockUseMediaHistory.mockReturnValue({
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: true,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  });

  const tree = await render(<MediaHistoryWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('media-history-freshness-dot');
  expect(text).toContain('error');

  await unmount(tree);
});
