import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useGeofences} from '../src/web-parity/api/hooks/useLocations';
import {
  ConditionBuilder,
  createDefaultCondition,
  type AutomationConditionStepInput,
} from '../src/web-parity/features/automations/pages/ConditionBuilder';

jest.mock('../src/web-parity/api/hooks/useLocations', () => ({
  useGeofences: jest.fn(),
}));

const mockUseGeofences = useGeofences as unknown as jest.Mock;

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
  mockUseGeofences.mockReturnValue({
    data: [
      {id: '7', name: 'Home'},
      {id: '8', name: 'Office'},
    ],
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(
  conditions: AutomationConditionStepInput[],
  onChange: (next: AutomationConditionStepInput[]) => void,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ConditionBuilder conditions={conditions} onChange={onChange} />,
    );
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

function pressableByTestID(
  tree: ReactTestRenderer.ReactTestRenderer,
  testID: string,
): ReactTestRenderer.ReactTestInstance {
  // A Pressable surfaces both a composite node and a host node carrying the
  // testID; only the node owning the onPress callback is the interactive one.
  const node = tree.root
    .findAll(
      candidate =>
        candidate.props?.testID === testID &&
        typeof candidate.props?.onPress === 'function',
    )
    .at(0);
  if (!node) {
    throw new Error(`No pressable found with testID "${testID}"`);
  }
  return node;
}

async function press(
  tree: ReactTestRenderer.ReactTestRenderer,
  testID: string,
): Promise<void> {
  await ReactTestRenderer.act(async () => {
    pressableByTestID(tree, testID).props.onPress();
  });
}

async function selectOption(
  tree: ReactTestRenderer.ReactTestRenderer,
  fieldTestID: string,
  optionValue: string,
): Promise<void> {
  // Open the modal listbox, then tap the option row (web inline <select> parity).
  await press(tree, fieldTestID);
  await press(tree, `${fieldTestID}-option-${optionValue}`);
}

test('createDefaultCondition builds the documented default for every kind', () => {
  expect(createDefaultCondition('condition_signal')).toEqual({
    kind: 'condition_signal',
    signal: 'battery_level',
    op: '<',
    value_num: 20,
  });
  expect(createDefaultCondition('condition_time_window')).toEqual({
    kind: 'condition_time_window',
    start_time: '06:00',
    end_time: '09:00',
    timezone: 'UTC',
    days_of_week: [1, 2, 3, 4, 5],
  });
  expect(createDefaultCondition('condition_geofence')).toEqual({
    kind: 'condition_geofence',
    place_id: 0,
    state: 'inside',
  });
  expect(createDefaultCondition('condition_other_automation')).toEqual({
    kind: 'condition_other_automation',
    other_automation_id: 0,
    state: 'enabled',
  });
});

test('renders one panel per condition with the kind-specific fields', async () => {
  const conditions: AutomationConditionStepInput[] = [
    {kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20},
    {
      kind: 'condition_time_window',
      start_time: '06:00',
      end_time: '09:00',
      timezone: 'UTC',
      days_of_week: [1, 2, 3, 4, 5],
    },
    {kind: 'condition_geofence', place_id: 0, state: 'inside'},
    {kind: 'condition_other_automation', other_automation_id: 0, state: 'enabled'},
  ];

  const tree = await render(conditions, () => {});
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('condition-builder');
  // Only the first condition shows the "Condition Type" label, exactly like web.
  expect(text).toContain('Condition Type');

  // Signal condition fields.
  expect(raw).toContain('condition-signal-field');
  expect(raw).toContain('condition-signal-operator');
  expect(raw).toContain('condition-signal-value');
  expect(text).toContain('Signal');
  expect(text).toContain('Operator');

  // Time-window condition fields.
  expect(raw).toContain('condition-time-start');
  expect(raw).toContain('condition-time-end');
  expect(raw).toContain('condition-time-timezone');
  expect(text).toContain('Start');
  expect(text).toContain('End');
  expect(text).toContain('Timezone');
  expect(text).toContain('Days');
  // All seven weekday pills render.
  for (let day = 0; day < 7; day += 1) {
    expect(raw).toContain(`condition-day-${day}`);
  }

  // Geofence + other-automation condition fields.
  expect(raw).toContain('condition-geofence-place');
  expect(raw).toContain('condition-geofence-state');
  expect(raw).toContain('condition-other-id');
  expect(raw).toContain('condition-other-state');
  expect(text).toContain('Geofence');
  expect(text).toContain('State');
  expect(text).toContain('Automation ID');

  // Add affordance is always present.
  expect(raw).toContain('condition-builder-add');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('Add Condition appends a default signal condition', async () => {
  const changes: AutomationConditionStepInput[][] = [];
  const existing: AutomationConditionStepInput[] = [
    {kind: 'condition_geofence', place_id: 4, state: 'outside'},
  ];

  const tree = await render(existing, next => changes.push(next));
  await press(tree, 'condition-builder-add');

  expect(changes).toHaveLength(1);
  expect(changes[0]).toEqual([
    existing[0],
    {kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20},
  ]);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('removing a condition drops the targeted index only', async () => {
  const changes: AutomationConditionStepInput[][] = [];
  const conditions: AutomationConditionStepInput[] = [
    {kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20},
    {kind: 'condition_geofence', place_id: 0, state: 'inside'},
  ];

  const tree = await render(conditions, next => changes.push(next));
  await press(tree, 'condition-1-remove');

  expect(changes).toEqual([[conditions[0]]]);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('changing the condition kind replaces it with that kind default', async () => {
  const changes: AutomationConditionStepInput[][] = [];
  const conditions: AutomationConditionStepInput[] = [
    {kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20},
  ];

  const tree = await render(conditions, next => changes.push(next));
  await selectOption(tree, 'condition-0-kind', 'condition_geofence');

  expect(changes).toEqual([
    [{kind: 'condition_geofence', place_id: 0, state: 'inside'}],
  ]);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('selecting a boolean signal swaps the value control to a true/false select', async () => {
  const changes: AutomationConditionStepInput[][] = [];
  const conditions: AutomationConditionStepInput[] = [
    {kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20},
  ];

  const tree = await render(conditions, next => changes.push(next));
  await selectOption(tree, 'condition-signal-field', 'is_charging');

  expect(changes).toEqual([
    [{kind: 'condition_signal', signal: 'is_charging', op: '=', value_bool: true}],
  ]);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('numeric value input coerces text into value_num', async () => {
  const changes: AutomationConditionStepInput[][] = [];
  const conditions: AutomationConditionStepInput[] = [
    {kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20},
  ];

  const tree = await render(conditions, next => changes.push(next));
  await ReactTestRenderer.act(async () => {
    const input = tree.root
      .findAll(
        candidate =>
          candidate.props?.testID === 'condition-signal-value' &&
          typeof candidate.props?.onChangeText === 'function',
      )
      .at(0);
    input?.props.onChangeText('35');
  });

  expect(changes).toEqual([
    [{kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 35}],
  ]);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('choosing the between operator switches to a min/max range', async () => {
  const changes: AutomationConditionStepInput[][] = [];
  const conditions: AutomationConditionStepInput[] = [
    {kind: 'condition_signal', signal: 'battery_level', op: '<', value_num: 20},
  ];

  const tree = await render(conditions, next => changes.push(next));
  await selectOption(tree, 'condition-signal-operator', 'between');

  expect(changes).toEqual([
    [
      {
        kind: 'condition_signal',
        signal: 'battery_level',
        op: 'between',
        value_min: 20,
        value_max: 100,
      },
    ],
  ]);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('day pills add an inactive day (sorted) and remove an active one', async () => {
  const changes: AutomationConditionStepInput[][] = [];
  const conditions: AutomationConditionStepInput[] = [
    {
      kind: 'condition_time_window',
      start_time: '06:00',
      end_time: '09:00',
      timezone: 'UTC',
      days_of_week: [1, 2, 3, 4, 5],
    },
  ];

  const tree = await render(conditions, next => changes.push(next));
  // Sunday (index 0) is inactive -> toggled on and sorted into the list.
  await press(tree, 'condition-day-0');
  // Monday (index 1) is active -> toggled off.
  await press(tree, 'condition-day-1');

  expect(changes[0][0]).toMatchObject({days_of_week: [0, 1, 2, 3, 4, 5]});
  expect(changes[1][0]).toMatchObject({days_of_week: [2, 3, 4, 5]});

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('time-window timezone select reports the chosen IANA zone', async () => {
  const changes: AutomationConditionStepInput[][] = [];
  const conditions: AutomationConditionStepInput[] = [
    {
      kind: 'condition_time_window',
      start_time: '06:00',
      end_time: '09:00',
      timezone: 'UTC',
      days_of_week: [1, 2, 3, 4, 5],
    },
  ];

  const tree = await render(conditions, next => changes.push(next));
  await selectOption(tree, 'condition-time-timezone', 'America/New_York');

  expect(changes[0][0]).toMatchObject({timezone: 'America/New_York'});

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
