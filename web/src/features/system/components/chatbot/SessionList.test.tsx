/**
 * SessionList — behaviour, branch, and a11y coverage.
 *
 * The module exports a single component (`SessionList`) plus two private
 * helpers (`displayTitle`, `editableTitle`) exercised transitively through
 * rendering and the inline-rename flow. These specs cover:
 *
 *   1. Chrome — the always-visible "New chat" button and "Sessions" header,
 *      and the button wiring to `onNewChat`.
 *   2. List states — loading placeholder (only when empty), the shared
 *      `<EmptyState>`, and that an in-flight refetch never hides existing rows.
 *   3. Row rendering — title, relative timestamp + message count, the "Empty"
 *      branch for sessions with no last message, and the two `displayTitle`
 *      fallbacks (truncated first message, then localized "Untitled").
 *   4. Selection + active state — clicking a row calls `onSelect`; the active
 *      row exposes `aria-current="true"` and inactive rows do not.
 *   5. Inline rename — double-click seeds the input, Enter commits a trimmed
 *      value, an empty draft is a no-op, Escape cancels, and blur commits. The
 *      seed uses the *editable* name (raw title / full first message), never
 *      the truncated "…" preview — the regression this file pins.
 *   6. Delete — the per-row control opens a confirm dialog; confirming forwards
 *      the id to `onDelete`, cancelling does not, and the control is suppressed
 *      while a row is being renamed.
 *
 * Network is never touched: `SessionList` is presentational (all data + effects
 * arrive through props). `react-i18next` is pinned to return the developer
 * fallback string, interpolating `{{count}}` so the message-count line resolves
 * to a concrete value and every `aria-label` gets a real accessible name.
 * Keyboard/pointer flows use user-event; branch checks also use fireEvent.
 * These are jsdom interaction/source checks, not measured native hitboxes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SessionList } from './SessionList';
import type { ChatSessionInfo } from '@/api/types';

const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  tz_display_default: 'user' as 'user' | 'vehicle' | 'utc',
  timezone_user: 'America/Los_Angeles',
  vehicleTimezone: 'Asia/Tokyo',
}));

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: preferences, locale: preferences.locale }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: { timezone: preferences.vehicleTimezone } }),
}));
// Exercise the real saved-mode resolver rather than setup's fixed UTC stub.
vi.unmock('@/lib/timezone');

beforeEach(() => {
  Object.assign(preferences, {
    locale: 'en-US',
    tz_display_default: 'user',
    timezone_user: 'America/Los_Angeles',
    vehicleTimezone: 'Asia/Tokyo',
  });
});

// i18n → return the developer fallback string, interpolating {{vars}} so the
// message-count line and every aria-label resolve to concrete strings.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const translate = (key: string, second?: unknown, third?: unknown): string => {
    const template = typeof second === 'string' ? second : key;
    const vars = (third && typeof third === 'object' ? third : undefined) as
      | Record<string, unknown>
      | undefined;
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      name in vars ? String(vars[name]) : `{{${name}}}`,
    );
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeSession(overrides: Partial<ChatSessionInfo> = {}): ChatSessionInfo {
  return {
    id: 's1',
    title: 'Trip planning',
    first_message: 'How far can I drive on a full charge?',
    message_count: 3,
    // 3.5 days ago → deterministically renders "3d ago" regardless of the
    // sub-second drift between fixture construction and formatRelative().
    last_message_at: new Date(Date.now() - 84 * 3_600_000).toISOString(),
    created_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function renderList(props: Partial<React.ComponentProps<typeof SessionList>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onNewChat: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };
  const sessions = props.sessions ?? [makeSession()];
  const activeSessionId = props.activeSessionId ?? '';
  const utils = render(
    <SessionList
      sessions={sessions}
      activeSessionId={activeSessionId}
      onSelect={props.onSelect ?? handlers.onSelect}
      onNewChat={props.onNewChat ?? handlers.onNewChat}
      onRename={props.onRename ?? handlers.onRename}
      onDelete={props.onDelete ?? handlers.onDelete}
      isLoading={props.isLoading}
    />,
  );
  return { ...utils, ...handlers };
}

describe('SessionList', () => {
  it('renders the New Chat control + Sessions header and fires onNewChat', () => {
    const { onNewChat } = renderList({ sessions: [] });

    expect(screen.getByText('Sessions')).toBeInTheDocument();
    const newChat = screen.getByRole('button', { name: 'New chat' });
    fireEvent.click(newChat);
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it('shows the loading placeholder only while loading with no sessions', () => {
    renderList({ sessions: [], isLoading: true });

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('No conversations yet')).toBeNull();
  });

  it('shows the shared EmptyState when there are no sessions and not loading', () => {
    renderList({ sessions: [], isLoading: false });

    const empty = screen.getByRole('status');
    expect(empty).toHaveTextContent('No conversations yet');
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('keeps rendering existing rows during an in-flight refetch', () => {
    renderList({ sessions: [makeSession({ title: 'Existing chat' })], isLoading: true });

    expect(screen.getByText('Existing chat')).toBeInTheDocument();
    // The loading placeholder is reserved for the initial empty load only.
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it("renders a row's title, relative time and message count", () => {
    renderList({ sessions: [makeSession({ title: 'Trip planning', message_count: 3 })] });

    expect(screen.getByText('Trip planning')).toBeInTheDocument();
    const meta = screen.getByText(/msgs/);
    expect(meta).toHaveTextContent('3d ago');
    expect(meta).toHaveTextContent('3 msgs');
  });

  it('labels a session with no last message as "Empty"', () => {
    renderList({
      sessions: [makeSession({ last_message_at: null, message_count: 0 })],
    });

    const meta = screen.getByText(/msgs/);
    expect(meta).toHaveTextContent('Empty');
    expect(meta).toHaveTextContent('0 msgs');
  });

  it('falls back to a truncated first message when a session has no title', () => {
    const longFirst = 'a'.repeat(80);
    renderList({ sessions: [makeSession({ title: null, first_message: longFirst })] });

    expect(screen.getByText(`${'a'.repeat(60)}…`)).toBeInTheDocument();
  });

  it('falls back to "Untitled conversation" with neither title nor first message', () => {
    renderList({ sessions: [makeSession({ title: null, first_message: null })] });

    expect(screen.getByText('Untitled conversation')).toBeInTheDocument();
  });

  it('selects a session when its row is clicked', () => {
    const { onSelect } = renderList({
      sessions: [makeSession({ id: 's-click', title: 'Pick me' })],
    });

    fireEvent.click(screen.getByText('Pick me'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('s-click');
  });

  it('marks only the active session with aria-current', () => {
    renderList({
      activeSessionId: 's-active',
      sessions: [
        makeSession({ id: 's-active', title: 'Active One' }),
        makeSession({ id: 's-other', title: 'Other One' }),
      ],
    });

    expect(screen.getByText('Active One').closest('button')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Other One').closest('button')).not.toHaveAttribute('aria-current');
  });

  it('enters rename mode on double-click and commits a trimmed title on Enter', () => {
    const { onRename } = renderList({
      sessions: [makeSession({ id: 's-ren', title: 'Old Title' })],
    });

    fireEvent.doubleClick(screen.getByText('Old Title'));
    const input = screen.getByRole('textbox', { name: 'Rename conversation' });
    expect(input).toHaveDisplayValue('Old Title');

    fireEvent.change(input, { target: { value: '  New Title  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('s-ren', 'New Title');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('seeds the rename input with the full, untruncated first message', () => {
    // Regression: the seed must be the *editable* name, not the sidebar's
    // truncated "…" preview — otherwise committing persists the ellipsis.
    const longFirst = 'a'.repeat(80);
    renderList({ sessions: [makeSession({ title: null, first_message: longFirst })] });

    fireEvent.doubleClick(screen.getByText(`${'a'.repeat(60)}…`));
    const input = screen.getByRole('textbox', { name: 'Rename conversation' });
    expect(input).toHaveDisplayValue(longFirst);
    expect((input as HTMLInputElement).value).not.toContain('…');
  });

  it('ignores an empty rename draft without calling onRename', () => {
    const { onRename } = renderList({
      sessions: [makeSession({ id: 's-keep', title: 'Keep Me' })],
    });

    fireEvent.doubleClick(screen.getByText('Keep Me'));
    const input = screen.getByRole('textbox', { name: 'Rename conversation' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).not.toHaveBeenCalled();
    // Rename mode exits and the original title is restored.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Keep Me')).toBeInTheDocument();
  });

  it('cancels a rename on Escape without committing', () => {
    const { onRename } = renderList({
      sessions: [makeSession({ id: 's-esc', title: 'Original' })],
    });

    fireEvent.doubleClick(screen.getByText('Original'));
    const input = screen.getByRole('textbox', { name: 'Rename conversation' });
    fireEvent.change(input, { target: { value: 'Edited' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Original')).toBeInTheDocument();
  });

  it('commits a rename when the input loses focus', () => {
    const { onRename } = renderList({
      sessions: [makeSession({ id: 's-blur', title: 'Old' })],
    });

    fireEvent.doubleClick(screen.getByText('Old'));
    const input = screen.getByRole('textbox', { name: 'Rename conversation' });
    fireEvent.change(input, { target: { value: 'Blurred' } });
    fireEvent.blur(input);

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('s-blur', 'Blurred');
  });

  it('opens a confirm dialog and deletes on confirm', () => {
    const { onDelete, onSelect } = renderList({
      sessions: [makeSession({ id: 's-del', title: 'Delete target' })],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('s-del');
    // Deleting must not double as a selection, and the dialog closes.
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses the delete dialog without deleting on cancel', () => {
    const { onDelete } = renderList({
      sessions: [makeSession({ id: 's-cancel', title: 'Spare me' })],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides the delete control while a row is being renamed', () => {
    renderList({ sessions: [makeSession({ id: 's-hide', title: 'Rename me' })] });

    expect(screen.getByRole('button', { name: 'Delete conversation' })).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText('Rename me'));
    expect(screen.queryByRole('button', { name: 'Delete conversation' })).toBeNull();
  });

  it('exposes named rename/delete controls without hover and keeps actions outside selection', () => {
    const { onSelect, onDelete, onRename } = renderList();
    const rename = screen.getByRole('button', { name: 'Rename conversation' });
    const remove = screen.getByRole('button', { name: 'Delete conversation' });

    for (const action of [rename, remove]) {
      expect(action).toBeVisible();
      expect(action).not.toHaveClass('opacity-0', 'absolute');
      expect(action.closest('button')).toBe(action);
      expect(action).toHaveAccessibleDescription('Trip planning');
      expect(action).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-9');
    }
    fireEvent.click(rename);
    expect(screen.getByRole('textbox', { name: 'Rename conversation' })).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onRename).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('supports keyboard-only rename, Enter save and focus return to the named action', async () => {
    const user = userEvent.setup();
    const { onRename, onSelect } = renderList();

    await user.tab();
    expect(screen.getByRole('button', { name: 'New chat' })).toHaveFocus();
    await user.tab();
    expect(screen.getByText('Trip planning').closest('button')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Rename conversation' })).toHaveFocus();
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: 'Rename conversation' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'Keyboard title{Enter}');

    expect(onRename).toHaveBeenCalledExactlyOnceWith('s1', 'Keyboard title');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rename conversation' })).toHaveFocus();
  });

  it('supports touch rename and Save without selecting or submitting twice', async () => {
    const user = userEvent.setup();
    const { onRename, onSelect } = renderList();

    await user.pointer([
      { keys: '[TouchA>]', target: screen.getByRole('button', { name: 'Rename conversation' }) },
      { keys: '[/TouchA]' },
    ]);
    const input = screen.getByRole('textbox', { name: 'Rename conversation' });
    await user.clear(input);
    await user.type(input, 'Touch title');
    const save = screen.getByRole('button', { name: 'Save' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    for (const control of [input, save, cancel]) {
      expect(control).toHaveClass('min-h-11', 'md:min-h-9');
    }
    await user.pointer([{ keys: '[TouchB>]', target: save }, { keys: '[/TouchB]' }]);

    expect(onRename).toHaveBeenCalledExactlyOnceWith('s1', 'Touch title');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('does not blur-save when tabbing to Cancel, and restores focus after cancellation', async () => {
    const user = userEvent.setup();
    const { onRename } = renderList();

    await user.click(screen.getByRole('button', { name: 'Rename conversation' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename conversation' }), ' change');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    expect(onRename).not.toHaveBeenCalled();
    await user.tab();
    await user.keyboard(' ');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Rename conversation' })).toHaveFocus();
  });

  it('supports pointer Cancel without committing the input on blur', async () => {
    const user = userEvent.setup();
    const { onRename } = renderList();

    await user.click(screen.getByRole('button', { name: 'Rename conversation' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename conversation' }), ' changed');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText('Trip planning')).toBeInTheDocument();
  });

  it('seeds named rename with the complete first message and never seeds the untitled label', () => {
    const first = 'Full question '.repeat(20);
    const view = renderList({
      sessions: [makeSession({ title: null, first_message: first })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rename conversation' }));
    expect(screen.getByRole('textbox')).toHaveValue(first.trim());

    view.unmount();
    renderList({ sessions: [makeSession({ title: ' ', first_message: null })] });
    fireEvent.click(screen.getByRole('button', { name: 'Rename conversation' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('retains the full first-message title and destructive confirmation before delete', async () => {
    const user = userEvent.setup();
    const first = 'A full conversation title '.repeat(12).trim();
    const { onDelete } = renderList({
      sessions: [makeSession({ id: 'long-title', title: null, first_message: first })],
    });
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete conversation?' });

    expect(within(dialog).getByText(first)).toBeInTheDocument();
    expect(within(dialog).getByText(
      'This will permanently remove this conversation and all its messages.',
    )).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveClass(
      'text-[var(--semantic-danger)]', 'min-h-11',
    );
    expect(onDelete).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete conversation' })).toHaveFocus();

    await user.keyboard('{Enter}');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('long-title');
  });

  it('keeps New chat and session selection at existing mobile minima in source', () => {
    renderList();
    expect(screen.getByRole('button', { name: 'New chat' })).toHaveClass(
      'min-h-11', 'min-w-11', 'md:min-h-9', 'md:min-w-0',
    );
    expect(screen.getByText('Trip planning').closest('button')).toHaveClass(
      'min-h-11', 'md:min-h-9', 'min-w-0', 'flex-1',
    );
  });

  it.each([
    { mode: 'user', locale: 'fr-FR', tz: 'America/Los_Angeles' },
    { mode: 'vehicle', locale: 'de-DE', tz: 'Asia/Tokyo' },
    { mode: 'utc', locale: 'en-GB', tz: 'UTC' },
  ] as const)('uses saved $mode timezone/$locale for old-session fallback dates', ({ mode, locale, tz }) => {
    const timestamp = '2026-06-01T00:30:00Z';
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-20T12:00:00Z'));
    preferences.locale = locale;
    preferences.tz_display_default = mode;
    const session = makeSession({ last_message_at: timestamp });
    renderList({ sessions: [session] });

    const expected = new Intl.DateTimeFormat(locale, {
      timeZone: tz, year: 'numeric', month: 'short', day: 'numeric',
    }).format(new Date(timestamp));
    expect(screen.getByText(/msgs/)).toHaveTextContent(expected);
    expect(session.last_message_at).toBe(timestamp);
    now.mockRestore();
  });

  it('responds to saved timezone changes without rewriting the session timestamp', () => {
    const timestamp = '2026-06-01T00:30:00Z';
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-20T12:00:00Z'));
    const session = makeSession({ last_message_at: timestamp });
    const callbacks = { onSelect: vi.fn(), onNewChat: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() };
    const view = render(
      <SessionList sessions={[session]} activeSessionId="" {...callbacks} />,
    );
    expect(screen.getByText(/msgs/)).toHaveTextContent('May 31, 2026');
    preferences.timezone_user = 'Asia/Tokyo';
    view.rerender(<SessionList sessions={[session]} activeSessionId="" {...callbacks} />);
    expect(screen.getByText(/msgs/)).toHaveTextContent('Jun 1, 2026');
    expect(session.last_message_at).toBe(timestamp);
    now.mockRestore();
  });

  it('keeps invalid last-message timestamps unknown rather than fabricating a date', () => {
    renderList({ sessions: [makeSession({ last_message_at: 'not-a-date' })] });
    expect(screen.getByText(/msgs/)).toHaveTextContent('— · 3 msgs');
  });
});
