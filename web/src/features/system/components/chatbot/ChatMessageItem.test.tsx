import type { ReactNode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { formatTime } from '@/lib/dateFormat';
import type { UIChatMessage } from './ChatMessageItem';
import { ChatMessageItem } from './ChatMessageItem';

// Deterministic i18n: return the inline English fallback so accessible
// names / labels are stable regardless of the (uninitialised) i18n store.
// This mock is shared by every descendant (CopyButton, Avatar, Textarea…).
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The real MarkdownRenderer lazy-loads react-markdown behind <Suspense>,
// which introduces async churn irrelevant to this unit. Render children
// verbatim in a queryable node so we can assert the assistant text path.
vi.mock('./MarkdownRenderer', () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

const CREATED_AT = '2025-01-15T12:34:00Z';

function makeMessage(overrides: Partial<UIChatMessage> = {}): UIChatMessage {
  return {
    id: 1,
    session_id: 'session-1',
    role: 'assistant',
    content: 'Hello there',
    created_at: CREATED_AT,
    ...overrides,
  };
}

/** Full "single, latest, standalone" render props for the given message. */
function renderItem(
  message: UIChatMessage,
  props: Partial<React.ComponentProps<typeof ChatMessageItem>> = {},
) {
  return render(
    <ChatMessageItem
      message={message}
      isLastAssistant={message.role === 'assistant'}
      isLastUser={message.role === 'user'}
      isFirstInGroup
      isLastInGroup
      {...props}
    />,
  );
}

describe('ChatMessageItem', () => {
  it('renders a user bubble with its text, role marker and a user avatar', () => {
    const message = makeMessage({ role: 'user', content: 'Where is my car?' });
    const { container } = renderItem(message);

    expect(screen.getByText('Where is my car?')).toBeInTheDocument();
    expect(container.querySelector('[data-role="user"]')).not.toBeNull();
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-avatar-kind', 'user');
    // A user message never routes through the markdown renderer.
    expect(screen.queryByTestId('markdown')).toBeNull();
  });

  it('renders an assistant bubble through the markdown renderer with a bot avatar', () => {
    const message = makeMessage({ role: 'assistant', content: '**Charging** now' });
    const { container } = renderItem(message);

    expect(screen.getByTestId('markdown')).toHaveTextContent('**Charging** now');
    expect(container.querySelector('[data-role="assistant"]')).not.toBeNull();
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-avatar-kind', 'bot');
  });

  it('shows the timestamp only on the last message in a group', () => {
    const expected = formatTime(CREATED_AT);
    const { rerender } = renderItem(makeMessage(), { isLastInGroup: true });
    expect(screen.getByText(expected)).toBeInTheDocument();

    rerender(
      <ChatMessageItem
        message={makeMessage()}
        isLastAssistant
        isLastUser={false}
        isFirstInGroup
        isLastInGroup={false}
      />,
    );
    expect(screen.queryByText(expected)).toBeNull();
  });

  it('dims the avatar into an invisible spacer when it is not first in the group', () => {
    renderItem(makeMessage(), { isFirstInGroup: false });
    const spacer = screen.getByTestId('avatar').parentElement as HTMLElement;
    expect(spacer.className).toContain('invisible');
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
  });

  it('while streaming: reveals streamedText, shows a blinking cursor, hides timestamp and actions', () => {
    const message = makeMessage({
      role: 'assistant',
      content: 'The full multi-line answer',
      streamedText: 'The full',
      isStreaming: true,
    });
    const { container } = renderItem(message, { onRegenerate: vi.fn() });

    // streamedText wins over content during the reveal.
    expect(screen.getByTestId('markdown')).toHaveTextContent('The full');
    expect(screen.getByTestId('markdown')).not.toHaveTextContent('multi-line');
    // Blinking caret is decorative and hidden from assistive tech.
    const caret = container.querySelector('span[aria-hidden="true"]');
    expect(caret).not.toBeNull();
    // No action row and no timestamp mid-stream.
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regenerate response' })).toBeNull();
    expect(screen.queryByText(formatTime(CREATED_AT))).toBeNull();
  });

  it('copies the message content to the clipboard from the icon-only copy control', async () => {
    const message = makeMessage({ role: 'assistant', content: 'copy me' });
    renderItem(message);

    const copy = screen.getByRole('button', { name: 'Copy message' });
    expect(copy).toBeInTheDocument();
    fireEvent.click(copy);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('copy me');
    });
  });

  it('offers Regenerate only for the last assistant message and forwards the message on click', () => {
    const onRegenerate = vi.fn();
    const message = makeMessage({ role: 'assistant' });
    renderItem(message, { onRegenerate });

    const regen = screen.getByRole('button', { name: 'Regenerate response' });
    fireEvent.click(regen);
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onRegenerate).toHaveBeenCalledWith(message);
  });

  it('hides Regenerate when not the last assistant or when no handler is supplied', () => {
    const message = makeMessage({ role: 'assistant' });

    const { rerender } = renderItem(message, {
      onRegenerate: vi.fn(),
      isLastAssistant: false,
    });
    expect(screen.queryByRole('button', { name: 'Regenerate response' })).toBeNull();

    // Handler omitted → affordance suppressed even on the last assistant reply.
    rerender(
      <ChatMessageItem
        message={message}
        isLastAssistant
        isLastUser={false}
        isFirstInGroup
        isLastInGroup
      />,
    );
    expect(screen.queryByRole('button', { name: 'Regenerate response' })).toBeNull();
  });

  it('hides the whole action row when actionsDisabled is set', () => {
    renderItem(makeMessage({ role: 'assistant' }), {
      onRegenerate: vi.fn(),
      actionsDisabled: true,
    });
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Regenerate response' })).toBeNull();
  });

  it('opens a focused, prefilled editor for the last user message', () => {
    const message = makeMessage({ role: 'user', content: 'original text' });
    renderItem(message, { onEditAndResend: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));

    const box = screen.getByRole('textbox', { name: 'Edit message' }) as HTMLTextAreaElement;
    expect(box).toBeInTheDocument();
    expect(box.value).toBe('original text');
    expect(document.activeElement).toBe(box);
  });

  it('does not offer inline edit for assistant messages or non-last user messages', () => {
    const { rerender } = renderItem(makeMessage({ role: 'assistant' }), {
      onEditAndResend: vi.fn(),
    });
    expect(screen.queryByRole('button', { name: 'Edit and resend' })).toBeNull();

    rerender(
      <ChatMessageItem
        message={makeMessage({ role: 'user' })}
        isLastAssistant={false}
        isLastUser={false}
        isFirstInGroup
        isLastInGroup
        onEditAndResend={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Edit and resend' })).toBeNull();
  });

  it('saves an edited message via the Save button and closes the editor', () => {
    const onEditAndResend = vi.fn();
    const message = makeMessage({ role: 'user', content: 'old' });
    renderItem(message, { onEditAndResend });

    fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), {
      target: { value: 'a brand new question' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save & resend' }));

    expect(onEditAndResend).toHaveBeenCalledWith(message, 'a brand new question');
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
  });

  it('disables Save and no-ops resend for empty or unchanged edits', () => {
    const onEditAndResend = vi.fn();
    renderItem(makeMessage({ role: 'user', content: 'unchanged' }), { onEditAndResend });

    fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));
    const box = screen.getByRole('textbox', { name: 'Edit message' });

    // Whitespace-only draft → disabled.
    fireEvent.change(box, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Save & resend' })).toBeDisabled();

    // Identical (modulo whitespace) draft → still disabled, and Enter cancels.
    fireEvent.change(box, { target: { value: '  unchanged  ' } });
    expect(screen.getByRole('button', { name: 'Save & resend' })).toBeDisabled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onEditAndResend).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
  });

  it('submits on Enter, inserts a newline on Shift+Enter, and cancels on Escape', () => {
    const onEditAndResend = vi.fn();
    const message = makeMessage({ role: 'user', content: 'seed' });
    const { rerender } = renderItem(message, { onEditAndResend });

    const openEditor = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));

    // Enter submits.
    openEditor();
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), {
      target: { value: 'via enter' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Enter' });
    expect(onEditAndResend).toHaveBeenCalledWith(message, 'via enter');

    // Shift+Enter must NOT submit (newline in the textarea instead).
    onEditAndResend.mockClear();
    rerender(
      <ChatMessageItem
        message={message}
        isLastAssistant={false}
        isLastUser
        isFirstInGroup
        isLastInGroup
        onEditAndResend={onEditAndResend}
      />,
    );
    openEditor();
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), {
      target: { value: 'line one' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), {
      key: 'Enter',
      shiftKey: true,
    });
    expect(onEditAndResend).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Edit message' })).toBeInTheDocument();

    // Escape cancels without resending and closes the editor.
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Edit message' }), { key: 'Escape' });
    expect(onEditAndResend).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
  });

  it('cancels an edit via the Cancel button without resending', () => {
    const onEditAndResend = vi.fn();
    renderItem(makeMessage({ role: 'user', content: 'keep me' }), { onEditAndResend });

    fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), {
      target: { value: 'discarded draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onEditAndResend).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull();
    expect(screen.getByText('keep me')).toBeInTheDocument();
  });

  it('tolerates a malformed payload with missing content without crashing on edit', () => {
    // A wire payload can violate the `content: string` contract (e.g. a
    // failed/empty assistant turn). The editor path calls `.trim()`, so this
    // guards the null-safety hardening in the source.
    const malformed = {
      ...makeMessage({ role: 'user' }),
      content: undefined as unknown as string,
    };
    renderItem(malformed, { onEditAndResend: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: 'Edit and resend' }));
    const box = screen.getByRole('textbox', { name: 'Edit message' }) as HTMLTextAreaElement;
    expect(box.value).toBe('');
    expect(screen.getByRole('button', { name: 'Save & resend' })).toBeDisabled();
  });
});
