import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  QuietHoursPanel,
  nextWindowChangeLabel,
} from '../src/web-parity/features/settings/components/QuietHoursPanel';

/**
 * Native parity contract for QuietHoursPanel.
 *
 * The web component is the Quiet hours / Do-Not-Disturb CRUD panel over
 * /api/v1/notifications/quiet-hours: a header with an "Add window" CTA, a
 * loading row, an empty state, a list of windows (enabled/disabled badge,
 * HH:MM → HH:MM (tz) summary, weekday pills, bypass-severity badges), and an
 * inline add/edit form (start/end time fields, timezone select, weekday + bypass
 * toggles, validation error, Cancel/Save). These tests mock the three ported
 * quiet-hours query/mutation hooks and assert the branch rendering, the
 * Add-button → form transition, the Save write path, and the exported
 * nextWindowChangeLabel pure helper.
 */

const mockUseQuietHours = jest.fn();
const mockSaveMutate = jest.fn();
const mockRemoveMutate = jest.fn();
const mockUseSaveQuietHours = jest.fn();
const mockUseDeleteQuietHours = jest.fn();

jest.mock('../src/web-parity/api/hooks/useNotifications', () => ({
  useQuietHours: (...args: unknown[]) => mockUseQuietHours(...args),
  useSaveQuietHours: (...args: unknown[]) => mockUseSaveQuietHours(...args),
  useDeleteQuietHours: (...args: unknown[]) => mockUseDeleteQuietHours(...args),
}));

// FadeIn wraps children in an Animated.View whose useNativeDriver timer would
// fire after the Jest env tears down. The animation is irrelevant to the parity
// assertions, so render children directly.
jest.mock('../src/web-parity/components/motion/FadeIn', () => {
  const ReactLocal = require('react');
  return {
    FadeIn: ({ children }: { children: unknown }) =>
      ReactLocal.createElement(ReactLocal.Fragment, null, children),
  };
});

type Tree = ReactTestRenderer.ReactTestRenderer;

interface QuietHoursWindow {
  id: number;
  user_id: string;
  enabled: boolean;
  start_local: string;
  end_local: string;
  timezone: string;
  weekdays: number;
  bypass_severities: string[];
  created_at: string;
  updated_at: string;
}

const SAMPLE: QuietHoursWindow = {
  id: 7,
  user_id: 'user-1',
  enabled: true,
  start_local: '23:00',
  end_local: '07:00',
  timezone: 'Europe/London',
  weekdays: 127,
  bypass_severities: ['critical'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function json(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

// RN copies testID onto BOTH the composite and the host instance, so count only
// host instances (typeof type === 'string') to get the real DOM-equivalent tally.
function hostCount(tree: Tree, testID: string): number {
  return tree.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  ).length;
}

function pressByTestID(tree: Tree, testID: string): void {
  const host = tree.root
    .findAll(n => n.props?.testID === testID)
    .find(n => typeof n.props?.onPress === 'function');
  if (!host) {
    throw new Error(`no pressable with testID="${testID}"`);
  }
  ReactTestRenderer.act(() => {
    host.props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseQuietHours.mockReturnValue({ data: [SAMPLE], isLoading: false });
  mockSaveMutate.mockReset();
  mockRemoveMutate.mockReset();
  mockUseSaveQuietHours.mockReturnValue({
    mutate: mockSaveMutate,
    isPending: false,
  });
  mockUseDeleteQuietHours.mockReturnValue({
    mutate: mockRemoveMutate,
    isPending: false,
  });
});

test('renders the header title, subtitle, and the Add window CTA', () => {
  const tree = render(<QuietHoursPanel />);

  const body = json(tree);
  expect(body).toContain('Quiet hours / Do-Not-Disturb');
  expect(body).toContain('Defer non-critical notifications');
  expect(body).toContain('Add window');

  ReactTestRenderer.act(() => tree.unmount());
});

test('renders a window row with the enabled badge, summary, and bypass badge', () => {
  const tree = render(<QuietHoursPanel />);

  // The list container + the per-row testID are preserved.
  expect(hostCount(tree, 'quiet-hours-list')).toBe(1);
  expect(hostCount(tree, 'quiet-hours-row-7')).toBe(1);

  const body = json(tree);
  expect(body).toContain('Enabled');
  // summarizeWindow(w) = `${start} → ${end} (${tz})`.
  expect(body).toContain('23:00 → 07:00 (Europe/London)');
  // bypass_severities badge.
  expect(body).toContain('critical');
  // weekday pills.
  expect(body).toContain('Mon');
  expect(body).toContain('Sun');

  ReactTestRenderer.act(() => tree.unmount());
});

test('loading state shows the spinner copy and no list', () => {
  mockUseQuietHours.mockReturnValue({ data: undefined, isLoading: true });

  const tree = render(<QuietHoursPanel />);

  expect(json(tree)).toContain('Loading quiet-hours windows…');
  expect(hostCount(tree, 'quiet-hours-list')).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('empty state shows the placeholder message when there are no windows', () => {
  mockUseQuietHours.mockReturnValue({ data: [], isLoading: false });

  const tree = render(<QuietHoursPanel />);

  expect(json(tree)).toContain('No quiet-hours windows yet');

  ReactTestRenderer.act(() => tree.unmount());
});

test('pressing Add opens the form and hides the Add CTA', () => {
  mockUseQuietHours.mockReturnValue({ data: [], isLoading: false });

  const tree = render(<QuietHoursPanel />);
  expect(hostCount(tree, 'quiet-hours-form')).toBe(0);

  pressByTestID(tree, 'quiet-hours-add');

  expect(hostCount(tree, 'quiet-hours-form')).toBe(1);
  // The Add CTA is gated on !draft, so it disappears once the form is open.
  expect(hostCount(tree, 'quiet-hours-add')).toBe(0);
  // The new-window form title (not the edit title).
  expect(json(tree)).toContain('New quiet-hours window');

  ReactTestRenderer.act(() => tree.unmount());
});

test('Save with the default valid draft calls save.mutate with the SI snake_case payload', () => {
  mockUseQuietHours.mockReturnValue({ data: [], isLoading: false });

  const tree = render(<QuietHoursPanel />);
  pressByTestID(tree, 'quiet-hours-add');
  pressByTestID(tree, 'quiet-hours-save');

  expect(mockSaveMutate).toHaveBeenCalledTimes(1);
  const [payload] = mockSaveMutate.mock.calls[0];
  expect(payload).toMatchObject({
    enabled: true,
    start_local: '23:00',
    end_local: '07:00',
    weekdays: 127,
    bypass_severities: ['critical'],
  });
  // A brand-new window has no id.
  expect(payload.id).toBeUndefined();

  ReactTestRenderer.act(() => tree.unmount());
});

test('pressing Delete on a row calls remove.mutate with the window id', () => {
  const tree = render(<QuietHoursPanel />);

  // The Delete button has no testID; locate it via its accessibilityState and
  // the row, so press the danger action by finding the pressable whose onPress
  // triggers the mutation. The row exposes two action buttons (Edit, Delete);
  // invoke them and assert remove.mutate fired with the id.
  const actions = tree.root
    .findAll(
      n =>
        n.props?.accessibilityRole === 'button' &&
        typeof n.props?.onPress === 'function',
    )
    .filter(n => n.props?.testID == null);
  // Fire every untagged action button; only Delete calls remove.mutate.
  ReactTestRenderer.act(() => {
    actions.forEach(n => n.props.onPress());
  });

  expect(mockRemoveMutate).toHaveBeenCalledWith(7, expect.any(Object));

  ReactTestRenderer.act(() => tree.unmount());
});

describe('nextWindowChangeLabel', () => {
  const base: QuietHoursWindow = {
    ...SAMPLE,
    start_local: '23:00',
    end_local: '07:00',
    weekdays: 127,
  };

  test('returns null when the window is disabled', () => {
    expect(
      nextWindowChangeLabel({ ...base, enabled: false }, new Date()),
    ).toBeNull();
  });

  test('returns null when today is not in the weekday mask', () => {
    // Sunday (getDay 0 -> bit 1); a mask without Sunday is off today.
    const sunday = new Date(2024, 0, 7, 12, 0); // 2024-01-07 is a Sunday
    expect(
      nextWindowChangeLabel({ ...base, weekdays: 126 }, sunday),
    ).toBeNull();
  });

  test('wrapping window before end -> "ends at"', () => {
    // 02:00 is inside the 23:00->07:00 wrap window.
    const at0200 = new Date(2024, 0, 8, 2, 0);
    expect(nextWindowChangeLabel(base, at0200)).toBe('ends at 07:00');
  });

  test('wrapping window after start -> "ends tomorrow at"', () => {
    const at2330 = new Date(2024, 0, 8, 23, 30);
    expect(nextWindowChangeLabel(base, at2330)).toBe('ends tomorrow at 07:00');
  });

  test('wrapping window between end and start -> "starts at"', () => {
    const at1200 = new Date(2024, 0, 8, 12, 0);
    expect(nextWindowChangeLabel(base, at1200)).toBe('starts at 23:00');
  });

  test('non-wrapping window before start -> "starts at"', () => {
    const win = { ...base, start_local: '09:00', end_local: '17:00' };
    const at0800 = new Date(2024, 0, 8, 8, 0);
    expect(nextWindowChangeLabel(win, at0800)).toBe('starts at 09:00');
  });

  test('non-wrapping window after end -> "starts tomorrow at"', () => {
    const win = { ...base, start_local: '09:00', end_local: '17:00' };
    const at1800 = new Date(2024, 0, 8, 18, 0);
    expect(nextWindowChangeLabel(win, at1800)).toBe('starts tomorrow at 09:00');
  });
});
