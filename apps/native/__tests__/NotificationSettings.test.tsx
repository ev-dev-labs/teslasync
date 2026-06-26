import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// The settings hooks are mocked so the view renders synchronously without a
// QueryClientProvider, network, or open handles (the NotificationChannelsView
// mocking precedent). The mock buckets are read only when each hook is *called*
// (render time), so the `let`s are safely initialised before the factory
// closures dereference them.
type SettingsQuery = {data?: Record<string, unknown> | undefined};

let mockSettings: SettingsQuery = {data: undefined};
const mockSave = jest.fn();

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => mockSettings,
  useSaveSettings: () => ({mutate: mockSave}),
}));

import {
  NotificationSettings,
  setNotificationSoundPrefs,
} from '../src/web-parity/features/settings/components/NotificationSettings';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const FULL_SETTINGS = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'dark',
  mode: 'dark',
  custom_primary: '#000',
  custom_accent: '#fff',
  gas_price_per_unit: 4,
  gas_unit: 'gal',
  gas_efficiency_mpg: 25,
  decimal_precision: 1,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  tab_badge_enabled: true,
  critical_flash_enabled: true,
};

let currentTree: Renderer | null = null;

type HostNode = {
  type?: string;
  props?: Record<string, any>;
  children?: HostNode[] | null;
};

function walkHosts(json: unknown): HostNode[] {
  const out: HostNode[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    const nodes = Array.isArray(node) ? node : [node as HostNode];
    for (const n of nodes) {
      if (!n || typeof n !== 'object') {
        continue;
      }
      out.push(n as HostNode);
      visit((n as HostNode).children);
    }
  };
  visit(json);
  return out;
}

// Host tree (toJSON) carries each testID exactly once — unlike tree.root, whose
// composite + host instances duplicate every testID.
function countTestID(tree: Renderer, testID: string): number {
  return walkHosts(tree.toJSON()).filter(n => n.props?.testID === testID).length;
}

// onPress lives on the composite Pressable instance (not the host tree), so
// presses target tree.root, narrowing to the single instance that owns onPress.
function pressTestID(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    node =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function checkedFor(tree: Renderer, testID: string): boolean | undefined {
  const node = walkHosts(tree.toJSON()).find(n => n.props?.testID === testID);
  return node?.props?.accessibilityState?.checked;
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

function render(): Renderer {
  let tree!: Renderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<NotificationSettings />);
  });
  currentTree = tree;
  return tree;
}

describe('NotificationSettings (native parity)', () => {
  beforeEach(() => {
    mockSettings = {data: undefined};
    mockSave.mockClear();
    // Reset the module-level sound store to its defaults so tests are
    // order-independent.
    setNotificationSoundPrefs({
      master: false,
      volume: 0.6,
      perCategory: {
        critical_alert: true,
        warning_alert: true,
        info_alert: false,
        charge_complete: true,
        drive_complete: false,
        automation_run: false,
        achievement: false,
      },
    });
  });

  afterEach(() => {
    if (currentTree) {
      ReactTestRenderer.act(() => {
        currentTree?.unmount();
      });
      currentTree = null;
    }
  });

  it('renders the panel header and the native-unavailable notifications message', () => {
    const tree = render();
    expect(countTestID(tree, 'settings-notifications')).toBe(1);
    expect(hasText(tree, 'Browser Notifications')).toBe(true);
    expect(countTestID(tree, 'browser-notifications-unsupported')).toBe(1);
    expect(hasText(tree, 'not supported')).toBe(true);
    // The browser permission flow (Enable button / Enabled badge) never renders
    // because notifications are unsupported on native.
    expect(hasText(tree, 'Enable Browser Notifications')).toBe(false);
    expect(countTestID(tree, 'browser-notifications-enabled')).toBe(0);
  });

  it('renders the browser-tab signal toggles defaulted ON when settings are present', () => {
    mockSettings = {data: FULL_SETTINGS};
    const tree = render();
    expect(hasText(tree, 'Browser tab signals')).toBe(true);
    expect(countTestID(tree, 'tab-badge-toggle')).toBe(1);
    expect(countTestID(tree, 'tab-flash-toggle')).toBe(1);
    expect(checkedFor(tree, 'tab-badge-toggle')).toBe(true);
    expect(checkedFor(tree, 'tab-flash-toggle')).toBe(true);
  });

  it('saves the full settings object with the flipped tab-badge flag', () => {
    mockSettings = {data: FULL_SETTINGS};
    const tree = render();
    pressTestID(tree, 'tab-badge-toggle');
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toMatchObject({
      ...FULL_SETTINGS,
      tab_badge_enabled: false,
    });
  });

  it('does not save a tab setting when settings have not loaded yet', () => {
    mockSettings = {data: undefined};
    const tree = render();
    pressTestID(tree, 'tab-flash-toggle');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('renders the notification-sounds section with all seven category rows', () => {
    const tree = render();
    expect(countTestID(tree, 'notification-sounds')).toBe(1);
    expect(countTestID(tree, 'notification-sound-master')).toBe(1);
    expect(countTestID(tree, 'notification-sound-volume')).toBe(1);
    for (const category of [
      'critical_alert',
      'warning_alert',
      'info_alert',
      'charge_complete',
      'drive_complete',
      'automation_run',
      'achievement',
    ]) {
      expect(countTestID(tree, `notification-sound-category-${category}`)).toBe(
        1,
      );
      expect(countTestID(tree, `notification-sound-test-${category}`)).toBe(1);
    }
    // default volume 0.6 -> 60%
    expect(hasText(tree, '60%')).toBe(true);
  });

  it('toggles the master sound switch and reveals the autoplay hint', () => {
    const tree = render();
    expect(checkedFor(tree, 'notification-sound-master')).toBe(false);
    expect(hasText(tree, 'authorise playback')).toBe(false);
    pressTestID(tree, 'notification-sound-master');
    expect(checkedFor(tree, 'notification-sound-master')).toBe(true);
    // master ON + hint not dismissed -> autoplay hint shows
    expect(hasText(tree, 'authorise playback')).toBe(true);
  });

  it('toggles a per-category sound channel through the store', () => {
    const tree = render();
    expect(checkedFor(tree, 'notification-sound-toggle-info_alert')).toBe(false);
    pressTestID(tree, 'notification-sound-toggle-info_alert');
    expect(checkedFor(tree, 'notification-sound-toggle-info_alert')).toBe(true);
  });

  it('keeps the autoplay hint up when a test cue is pressed (no native audio)', () => {
    const tree = render();
    ReactTestRenderer.act(() => {
      setNotificationSoundPrefs({master: true});
    });
    expect(hasText(tree, 'authorise playback')).toBe(true);
    // Pressing Test resolves to no_audio_context, which re-asserts the hint.
    pressTestID(tree, 'notification-sound-test-critical_alert');
    expect(hasText(tree, 'authorise playback')).toBe(true);
  });
});
