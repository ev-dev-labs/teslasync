import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  AI_FEATURE_IDS,
  AI_FEATURES,
  type AiFeatureId,
} from '../src/web-parity/ai/features';
import {AIFeatureToggleList} from '../src/web-parity/features/settings/components/AIFeatureToggleList';

function allOff(): Record<AiFeatureId, boolean> {
  return AI_FEATURE_IDS.reduce((acc, id) => {
    acc[id] = false;
    return acc;
  }, {} as Record<AiFeatureId, boolean>);
}

function findByTestID(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
): ReactTestRenderer.ReactTestInstance | undefined {
  return tree?.root.findAll(node => node.props.testID === testID).at(0);
}

test('renders a generated row + switch for every registry feature id', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AIFeatureToggleList values={allOff()} onToggle={() => {}} />,
    );
  });

  expect(findByTestID(tree, 'ai-feature-toggle-list')).toBeDefined();

  // The list is generated from AI_FEATURE_IDS — one row + one switch per id.
  for (const id of AI_FEATURE_IDS) {
    expect(findByTestID(tree, `ai-feature-row-${id}`)).toBeDefined();
    expect(findByTestID(tree, `ai-feature-toggle-${id}`)).toBeDefined();
  }

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('falls back to the registry name/description when no translation exists', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AIFeatureToggleList values={allOff()} onToggle={() => {}} />,
    );
  });

  const json = JSON.stringify(tree?.toJSON());
  expect(json).toContain('Per-feature opt-in (all default off)');

  const sampleId = AI_FEATURE_IDS[0];
  expect(json).toContain(AI_FEATURES[sampleId].name);
  expect(json).toContain(AI_FEATURES[sampleId].description);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('reflects the controlled value and reports the flipped boolean on toggle', async () => {
  const sampleId = AI_FEATURE_IDS[0];
  const calls: Array<[AiFeatureId, boolean]> = [];
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AIFeatureToggleList
        values={allOff()}
        onToggle={(id, value) => calls.push([id, value])}
      />,
    );
  });

  const node = findByTestID(tree, `ai-feature-toggle-${sampleId}`);
  expect(node?.props.accessibilityState).toEqual({checked: false});
  expect(node?.props.accessibilityLabel).toBe(AI_FEATURES[sampleId].name);

  await ReactTestRenderer.act(async () => {
    node?.props.onPress();
  });
  expect(calls).toEqual([[sampleId, true]]);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('renders a switch in the on state when its value is true', async () => {
  const sampleId = AI_FEATURE_IDS[0];
  const values = allOff();
  values[sampleId] = true;
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <AIFeatureToggleList values={values} onToggle={() => {}} />,
    );
  });

  const node = findByTestID(tree, `ai-feature-toggle-${sampleId}`);
  expect(node?.props.accessibilityState).toEqual({checked: true});

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
