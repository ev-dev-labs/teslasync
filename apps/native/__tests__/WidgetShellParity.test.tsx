import React from 'react';
import {Text} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  usePinned,
  useTogglePin,
} from '../src/web-parity/api/hooks/usePinned';
import {WidgetShell} from '../src/web-parity/features/dashboard/widgets/WidgetShell';

jest.mock('../src/web-parity/api/hooks/usePinned', () => ({
  usePinned: jest.fn(),
  useTogglePin: jest.fn(),
}));

const mockUsePinned = usePinned as unknown as jest.Mock;
const mockUseTogglePin = useTogglePin as unknown as jest.Mock;
const mockMutate = jest.fn();

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

beforeEach(() => {
  mockUsePinned.mockReturnValue({data: []});
  mockUseTogglePin.mockReturnValue({mutate: mockMutate, isPending: false});
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

async function unmount(
  tree: ReactTestRenderer.ReactTestRenderer,
): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
}

const RECENT = Date.now() - 5 * 60_000;

test('renders only the loading skeleton while loading', async () => {
  const tree = await render(
    <WidgetShell title="Battery" loading>
      <Text>body</Text>
    </WidgetShell>,
  );
  const raw = rawOf(tree);

  expect(raw).toContain('widget-shell-skeleton');
  expect(raw).not.toContain('widget-shell"');
  expect(textOf(tree)).not.toContain('body');

  await unmount(tree);
});

test('renders the generic network error state when error is set', async () => {
  const tree = await render(
    <WidgetShell title="Battery" error="boom">
      <Text>body</Text>
    </WidgetShell>,
  );
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('widget-shell-error');
  expect(text).toContain("Can't reach server");
  expect(text).toContain('Check your internet connection and try again.');
  // Web QueryError never renders the raw error string for a plain Error.
  expect(text).not.toContain('boom');
  expect(text).not.toContain('body');

  await unmount(tree);
});

test('renders the title header with the body children', async () => {
  const tree = await render(
    <WidgetShell title="Battery Health">
      <Text>charge curve</Text>
    </WidgetShell>,
  );
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('widget-shell"');
  expect(text).toContain('Battery Health');
  expect(text).toContain('charge curve');

  await unmount(tree);
});

test('renders the freshness chip with a relative label from updatedAt', async () => {
  const tree = await render(
    <WidgetShell title="Battery" updatedAt={RECENT}>
      <Text>body</Text>
    </WidgetShell>,
  );
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('widget-shell-freshness');
  expect(raw).toContain('widget-shell-freshness-dot');
  expect(text).toContain('5m ago');

  await unmount(tree);
});

test('shows the updating label while fetching', async () => {
  const tree = await render(
    <WidgetShell title="Battery" updatedAt={RECENT} isFetching>
      <Text>body</Text>
    </WidgetShell>,
  );
  expect(textOf(tree)).toContain('updating\u2026');
  await unmount(tree);
});

test('invokes onRefresh when the freshness chip is pressed', async () => {
  const onRefresh = jest.fn();
  const tree = await render(
    <WidgetShell title="Battery" updatedAt={RECENT} onRefresh={onRefresh}>
      <Text>body</Text>
    </WidgetShell>,
  );

  await ReactTestRenderer.act(async () => {
    tree.root.findByProps({testID: 'widget-shell-freshness'}).props.onPress();
  });
  expect(onRefresh).toHaveBeenCalledTimes(1);

  await unmount(tree);
});

test('derives freshness from a TanStack Query result via query prop', async () => {
  const refetch = jest.fn().mockResolvedValue(undefined);
  const tree = await render(
    <WidgetShell
      title="Battery"
      query={{
        isFetching: false,
        isStale: false,
        isError: false,
        dataUpdatedAt: RECENT,
        refetch,
      }}>
      <Text>body</Text>
    </WidgetShell>,
  );

  expect(textOf(tree)).toContain('5m ago');

  await ReactTestRenderer.act(async () => {
    tree.root.findByProps({testID: 'widget-shell-freshness'}).props.onPress();
  });
  expect(refetch).toHaveBeenCalledTimes(1);

  await unmount(tree);
});

test('reflects the error freshness state in the header chip', async () => {
  const tree = await render(
    <WidgetShell title="Battery" updatedAt={0} isError>
      <Text>body</Text>
    </WidgetShell>,
  );
  const raw = rawOf(tree);
  expect(raw).toContain('widget-shell-freshness-dot');
  expect(textOf(tree)).toContain('error');
  await unmount(tree);
});

test('renders the help tooltip and reveals its text on press', async () => {
  const tree = await render(
    <WidgetShell
      title="Battery"
      help={{i18nKey: 'help.battery', defaultValue: 'State of health explained'}}>
      <Text>body</Text>
    </WidgetShell>,
  );

  expect(rawOf(tree)).toContain('widget-shell-help');
  expect(textOf(tree)).not.toContain('State of health explained');

  await ReactTestRenderer.act(async () => {
    tree.root.findByProps({testID: 'widget-shell-help'}).props.onPress();
  });

  expect(textOf(tree)).toContain('State of health explained');

  await unmount(tree);
});

test('renders the pin button and toggles via useTogglePin when widgetId+dashboardId set', async () => {
  const tree = await render(
    <WidgetShell title="Battery" widgetId="battery-health" dashboardId="dash-1">
      <Text>body</Text>
    </WidgetShell>,
  );

  expect(rawOf(tree)).toContain('pin-button');
  expect(mockUsePinned).toHaveBeenCalledWith('widget', 'dash-1');

  await ReactTestRenderer.act(async () => {
    tree.root.findByProps({testID: 'pin-button'}).props.onPress();
  });
  expect(mockMutate).toHaveBeenCalledWith({
    itemId: 'battery-health',
    context: 'dash-1',
    pin: true,
  });

  await unmount(tree);
});

test('floats a compact freshness overlay for title-less widgets', async () => {
  const tree = await render(
    <WidgetShell updatedAt={RECENT}>
      <Text>compact body</Text>
    </WidgetShell>,
  );
  const raw = rawOf(tree);
  const text = textOf(tree);

  // Compact mode is dot-only: the dot renders but the relative label does not.
  expect(raw).toContain('widget-shell-freshness-dot');
  expect(text).not.toContain('5m ago');
  expect(text).toContain('compact body');

  await unmount(tree);
});

test('renders title-less action row without a header', async () => {
  const tree = await render(
    <WidgetShell actions={<Text>refresh-action</Text>}>
      <Text>body</Text>
    </WidgetShell>,
  );
  const text = textOf(tree);
  expect(text).toContain('refresh-action');
  expect(text).toContain('body');
  await unmount(tree);
});

test('still renders body children when noPadding is set', async () => {
  const tree = await render(
    <WidgetShell title="Battery" noPadding>
      <Text>edge to edge</Text>
    </WidgetShell>,
  );
  expect(textOf(tree)).toContain('edge to edge');
  await unmount(tree);
});

test('re-renders cleanly when the data timestamp changes (pulse path)', async () => {
  const tree = await render(
    <WidgetShell title="Battery" updatedAt={RECENT}>
      <Text>body</Text>
    </WidgetShell>,
  );

  await ReactTestRenderer.act(async () => {
    tree.update(
      <WidgetShell title="Battery" updatedAt={Date.now()}>
        <Text>body</Text>
      </WidgetShell>,
    );
  });

  expect(textOf(tree)).toContain('Battery');
  expect(textOf(tree)).toContain('body');

  await unmount(tree);
});
