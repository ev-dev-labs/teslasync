import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// The native automations hook is mocked so PresetGallery resolves its query
// synchronously without a QueryClientProvider, network, or open handles (the
// MileagePage / TeslaRegionPage mocking precedent). `mockPresets` is read only
// when useAutomationPresets is *called* (render time), so the `let` is safely
// initialised before the factory closure dereferences it.
type PresetsQuery = {
  data?: {presets: Array<Record<string, unknown>>};
  isLoading?: boolean;
};

let mockPresets: PresetsQuery = {data: {presets: []}, isLoading: false};

jest.mock('../src/web-parity/api/hooks/useAutomations', () => ({
  useAutomationPresets: (_category?: string) => mockPresets,
}));

import {PresetGallery} from '../src/web-parity/features/automations/pages/PresetGallery';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(): Renderer {
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<PresetGallery />);
  });
  return tree;
}

function countTestID(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  ).length;
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

describe('PresetGallery (native parity)', () => {
  it('renders four skeleton cards while loading', () => {
    mockPresets = {isLoading: true};
    const tree = render();
    expect(countTestID(tree, 'preset-gallery-loading')).toBe(1);
    expect(countTestID(tree, 'preset-gallery-empty')).toBe(0);
    expect(countTestID(tree, 'preset-card-p1')).toBe(0);
  });

  it('renders the empty state when there are no presets', () => {
    mockPresets = {data: {presets: []}, isLoading: false};
    const tree = render();
    expect(countTestID(tree, 'preset-gallery-empty')).toBe(1);
    expect(hasText(tree, 'No preset templates available')).toBe(true);
  });

  it('renders a preset card with name, trigger label, action count and install', () => {
    mockPresets = {
      data: {
        presets: [
          {
            id: 'p1',
            name: 'Sentry Saver',
            description: 'Arms Sentry when parked away from home.',
            category: 'security',
            icon: 'Siren',
            triggers: [{kind: 'trigger_schedule'}],
            conditions: [],
            actions: [{kind: 'action_command'}, {kind: 'action_notify'}],
            stop_on_failure: false,
            notify_on_run: false,
            notify_on_failure: false,
          },
        ],
      },
      isLoading: false,
    };
    const tree = render();
    expect(countTestID(tree, 'preset-card-p1')).toBe(1);
    expect(countTestID(tree, 'preset-install-p1')).toBe(1);
    expect(hasText(tree, 'Sentry Saver')).toBe(true);
    // triggerLabels[trigger_schedule] fallback.
    expect(hasText(tree, 'Schedule')).toBe(true);
    // actionCount `{{count}} actions` interpolation (2 actions).
    expect(hasText(tree, '2 actions')).toBe(true);
    expect(hasText(tree, 'Install')).toBe(true);
  });

  it('falls back to the no-trigger label when a preset has no triggers', () => {
    mockPresets = {
      data: {
        presets: [
          {
            id: 'p2',
            name: 'Untriggered',
            description: 'No trigger configured yet.',
            category: 'general',
            icon: 'UnknownIcon',
            triggers: [],
            conditions: [],
            actions: [],
            stop_on_failure: false,
            notify_on_run: false,
            notify_on_failure: false,
          },
        ],
      },
      isLoading: false,
    };
    const tree = render();
    expect(countTestID(tree, 'preset-card-p2')).toBe(1);
    expect(hasText(tree, 'No trigger configured')).toBe(true);
    // `{{count}} actions` with 0 actions.
    expect(hasText(tree, '0 actions')).toBe(true);
  });
});
