import React, {useState} from 'react';
import ReactTestRenderer from 'react-test-renderer';

// The three Alert Studio message-helper hooks are mocked so the editor renders
// synchronously without a QueryClientProvider, network, or open handles (the
// PresetGallery / VehicleMultiSelect mocking precedent). The mock buckets are
// read only when each hook is *called* (render time), so the `let`s are safely
// initialised before the factory closures dereference them.
type PlaceholdersQuery = {
  data?: Array<Record<string, unknown>>;
  isLoading?: boolean;
};
type PresetsQuery = {
  data?: Array<Record<string, unknown>>;
  isLoading?: boolean;
};

let mockPlaceholders: PlaceholdersQuery = {data: [], isLoading: false};
let mockPresets: PresetsQuery = {data: [], isLoading: false};
let mockPreview: {title: string; body: string} = {title: '', body: ''};
let mockPending = false;
const mockMutate = jest.fn();

jest.mock('../src/web-parity/api/hooks/useAlertMessageHelpers', () => ({
  useAlertMessagePlaceholders: () => mockPlaceholders,
  useAlertMessagePresets: () => mockPresets,
  useAlertMessagePreview: () => ({
    mutate: (
      body: unknown,
      opts?: {
        onSuccess?: (data: {title: string; body: string}) => void;
        onError?: (err: unknown) => void;
      },
    ) => {
      mockMutate(body);
      opts?.onSuccess?.(mockPreview);
    },
    isPending: mockPending,
  }),
}));

import {
  AlertMessageEditor,
  type AlertMessageEditorDraft,
} from '../src/web-parity/features/notifications/components/AlertMessageEditor';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const PLACEHOLDERS = [
  {key: 'BatteryLevel', label: 'Battery level', group: 'Signals'},
  {key: 'Speed', label: 'Vehicle speed', group: 'Signals'},
];

const PRESETS = [
  {
    id: 'p1',
    name: 'Low battery',
    description: 'Warn on low battery',
    template: 'Battery at {{BatteryLevel}}%',
    tags: ['battery'],
  },
  {
    id: 'p2',
    name: 'Speeding',
    template: 'Going {{Speed}}',
    tags: ['safety'],
  },
];

let currentTree: Renderer | null = null;

function countTestID(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    (node) =>
      typeof node.type === 'string' && node.props.testID === testID,
  ).length;
}

function press(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    (node) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function typeText(tree: Renderer, testID: string, text: string): void {
  const input = tree.root.find(
    (node) =>
      node.props.testID === testID &&
      typeof node.props.onChangeText === 'function',
  );
  ReactTestRenderer.act(() => {
    input.props.onChangeText(text);
    input.props.onSelectionChange?.({
      nativeEvent: {selection: {start: text.length, end: text.length}},
    });
  });
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

interface HarnessSpies {
  onTemplate: jest.Mock;
  onInclude: jest.Mock;
}

function renderEditor(options?: {
  template?: string;
  includeTitle?: boolean;
  draft?: AlertMessageEditorDraft;
}): {tree: Renderer; spies: HarnessSpies} {
  const spies: HarnessSpies = {onTemplate: jest.fn(), onInclude: jest.fn()};

  function Harness() {
    const [tpl, setTpl] = useState(options?.template ?? '');
    const [inc, setInc] = useState(options?.includeTitle ?? true);
    return (
      <AlertMessageEditor
        msgTemplate={tpl}
        includeTitle={inc}
        draft={options?.draft ?? {op: '<'}}
        onTemplateChange={(next) => {
          spies.onTemplate(next);
          setTpl(next);
        }}
        onIncludeTitleChange={(next) => {
          spies.onInclude(next);
          setInc(next);
        }}
      />
    );
  }

  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<Harness />);
  });
  currentTree = tree;
  return {tree, spies};
}

describe('AlertMessageEditor (native parity)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPlaceholders = {data: PLACEHOLDERS, isLoading: false};
    mockPresets = {data: PRESETS, isLoading: false};
    mockPreview = {title: '', body: ''};
    mockPending = false;
    mockMutate.mockClear();
  });

  afterEach(() => {
    if (currentTree) {
      ReactTestRenderer.act(() => {
        currentTree?.unmount();
      });
      currentTree = null;
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('renders the include-title checkbox, preset button, field, and empty preview', () => {
    const {tree} = renderEditor();
    expect(countTestID(tree, 'alert-message-editor')).toBe(1);
    expect(countTestID(tree, 'alert-message-template-include-title')).toBe(1);
    expect(countTestID(tree, 'alert-message-preset-button')).toBe(1);
    expect(countTestID(tree, 'alert-message-template')).toBe(1);
    expect(countTestID(tree, 'alert-message-preview')).toBe(1);
    expect(hasText(tree, 'Start typing to see a preview')).toBe(true);
    expect(hasText(tree, 'Include title in notifications')).toBe(true);
    expect(hasText(tree, 'Pick a preset')).toBe(true);
  });

  it('toggles include_title through the checkbox', () => {
    const {tree, spies} = renderEditor({includeTitle: true});
    press(tree, 'alert-message-template-include-title');
    expect(spies.onInclude).toHaveBeenCalledWith(false);
  });

  it('opens the {{ autocomplete, filters by the partial, and inserts the placeholder', () => {
    const {tree, spies} = renderEditor();

    typeText(tree, 'alert-message-template', '{{Bat');

    expect(countTestID(tree, 'alert-message-autocomplete')).toBe(1);
    expect(
      countTestID(tree, 'alert-message-autocomplete-option-BatteryLevel'),
    ).toBe(1);
    // The "Speed" placeholder does not match the "Bat" needle.
    expect(countTestID(tree, 'alert-message-autocomplete-option-Speed')).toBe(0);

    press(tree, 'alert-message-autocomplete-option-BatteryLevel');
    expect(spies.onTemplate).toHaveBeenLastCalledWith('{{BatteryLevel}}');
    // Selecting closes the dropdown.
    expect(countTestID(tree, 'alert-message-autocomplete')).toBe(0);
  });

  it('does not open the autocomplete for a closed brace expression', () => {
    const {tree} = renderEditor();
    typeText(tree, 'alert-message-template', '{{BatteryLevel}} ');
    expect(countTestID(tree, 'alert-message-autocomplete')).toBe(0);
  });

  it('opens the preset gallery, lists curated presets, and applies one', () => {
    const {tree, spies} = renderEditor();

    expect(countTestID(tree, 'alert-message-preset-modal')).toBe(0);
    press(tree, 'alert-message-preset-button');

    expect(countTestID(tree, 'alert-message-preset-modal')).toBe(1);
    expect(countTestID(tree, 'alert-message-preset-p1')).toBe(1);
    expect(countTestID(tree, 'alert-message-preset-p2')).toBe(1);
    expect(countTestID(tree, 'alert-message-tag-all')).toBe(1);
    expect(countTestID(tree, 'alert-message-tag-battery')).toBe(1);
    expect(countTestID(tree, 'alert-message-tag-safety')).toBe(1);

    press(tree, 'alert-message-preset-p1');
    expect(spies.onTemplate).toHaveBeenLastCalledWith('Battery at {{BatteryLevel}}%');
    // Applying closes the gallery.
    expect(countTestID(tree, 'alert-message-preset-modal')).toBe(0);
  });

  it('filters presets by the selected tag chip', () => {
    const {tree} = renderEditor();
    press(tree, 'alert-message-preset-button');
    expect(countTestID(tree, 'alert-message-preset-p1')).toBe(1);
    expect(countTestID(tree, 'alert-message-preset-p2')).toBe(1);

    press(tree, 'alert-message-tag-safety');
    expect(countTestID(tree, 'alert-message-preset-p1')).toBe(0);
    expect(countTestID(tree, 'alert-message-preset-p2')).toBe(1);
  });

  it('renders the debounced preview title and body when include_title is on', () => {
    mockPreview = {title: 'Low Battery', body: 'Battery at 12%'};
    const {tree} = renderEditor({template: 'Battery at {{BatteryLevel}}%', includeTitle: true});

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(mockMutate).toHaveBeenCalled();
    expect(countTestID(tree, 'alert-message-preview-title')).toBe(1);
    expect(hasText(tree, 'Low Battery')).toBe(true);
    expect(hasText(tree, 'Battery at 12%')).toBe(true);
  });

  it('hides the preview title when include_title is off', () => {
    mockPreview = {title: 'Low Battery', body: 'Battery at 12%'};
    const {tree} = renderEditor({template: 'x', includeTitle: false});

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(countTestID(tree, 'alert-message-preview-title')).toBe(0);
    expect(hasText(tree, 'Battery at 12%')).toBe(true);
  });

  it('shows the empty-body fallback when the rendered body is blank', () => {
    mockPreview = {title: 'Title only', body: ''};
    const {tree} = renderEditor({template: 'x', includeTitle: true});

    ReactTestRenderer.act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(hasText(tree, '(no body — title carries the alert)')).toBe(true);
  });
});
