/**
 * ChatbotPage (Helix) behavioural tests.
 *
 * Scope: the PAGE's own orchestration logic — submit routing (AI-off
 * heuristic POST /chatbot vs AI-on SSE POST /api/v1/ai/chatbot), the
 * keyboard contract (Enter / Shift+Enter / ArrowUp recall), session
 * sidebar toggling + localStorage persistence, session load / new-chat /
 * rename / delete wiring, suggestion pick, regenerate + edit-and-resend,
 * and the streaming-lifecycle state machine (delta accumulation, done
 * finalisation, SSE `error` frame, and the transport-level failure
 * finalisation added to unblock retries).
 *
 * Conventions mirrored from the sibling suite (DiagnosticPage.test.tsx +
 * the AI on-mode wiring tests):
 *   - The shared `request` client is mocked, so the real TanStack Query
 *     hooks run end-to-end without a network.
 *   - i18n falls back to the English `defaultValue`, with `{{message}}`
 *     interpolation for the AI-error marker.
 *   - The real `useAiStream` hook runs against a mocked `global.fetch`
 *     returning a deterministic SSE byte stream (the parser is exercised
 *     for real; only the socket is faked).
 *   - `@testing-library/user-event` is intentionally NOT a dependency of
 *     this codebase, so interactions use `fireEvent`.
 *
 * The heavy chat child components (ChatMessageItem / SessionList /
 * ChatWelcome) and the gated AI surfaces are replaced with light doubles:
 * they have their own tests, and doubling them lets us drive the page's
 * callbacks deterministically and assert the props it computes.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import {
  render,
  screen,
  act,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { ChatMessage, ChatSessionInfo } from '@/api/types';
import type { UIChatMessage } from '../components/chatbot/ChatMessageItem';

/* ─── controllable AI gate (hoisted so the mock factory can read it) ─── */
const ctrl = vi.hoisted(() => ({ aiEnabled: false }));

vi.mock('@/hooks/useAiEnabled', () => ({
  useAiEnabled: () => ctrl.aiEnabled,
}));

/* ─── deterministic instant typewriter (no rAF/timer flake) ─────────── */
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

/* ─── network client ─────────────────────────────────────────────────── */
vi.mock('@/api/client', () => ({
  request: vi.fn(),
  apiUrl: (p: string) => p,
}));

/* ─── i18n: English fallback + {{message}} interpolation ─────────────── */
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const translate = (
    key: string,
    second?: unknown,
    third?: unknown,
  ): string => {
    const opts =
      third && typeof third === 'object'
        ? (third as Record<string, unknown>)
        : second && typeof second === 'object'
          ? (second as Record<string, unknown>)
          : undefined;
    let str =
      typeof second === 'string'
        ? second
        : opts && typeof opts.defaultValue === 'string'
          ? opts.defaultValue
          : key;
    if (opts) {
      str = str.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
        opts[k] != null ? String(opts[k]) : `{{${k}}}`,
      );
    }
    return str;
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

/* ─── gated AI surfaces render nothing here (covered by their own tests) */
vi.mock('@/components/ai/AIChatbotIndicator', () => ({
  AIChatbotIndicator: () => null,
}));
vi.mock('@/components/ai/AIVoiceMode', () => ({
  AIVoiceMode: () => null,
}));

/* ─── chat child doubles ─────────────────────────────────────────────── */
interface DoubleMessageItemProps {
  message: UIChatMessage;
  isLastAssistant: boolean;
  isLastUser: boolean;
  actionsDisabled?: boolean;
  onRegenerate?: (message: UIChatMessage) => void;
  onEditAndResend?: (message: UIChatMessage, newText: string) => void;
}

vi.mock('../components/chatbot/ChatMessageItem', () => ({
  ChatMessageItem: (props: DoubleMessageItemProps) => {
    const {
      message,
      isLastAssistant,
      isLastUser,
      actionsDisabled,
      onRegenerate,
      onEditAndResend,
    } = props;
    return (
      <div
        data-testid="chat-msg"
        data-role={message.role}
        data-streaming={message.isStreaming ? 'true' : 'false'}
        data-actions-disabled={actionsDisabled ? 'true' : 'false'}
      >
        <span data-testid="chat-msg-text">
          {message.streamedText ?? message.content}
        </span>
        <span data-testid="chat-msg-evidence">
          {(message.aiActivity ?? [])
            .map((item) => `${item.name}:${item.status}`)
            .join(',')}
        </span>
        <span data-testid="chat-msg-usage">
          {message.aiUsage
            ? `${message.aiUsage.in + message.aiUsage.out} tokens`
            : ''}
        </span>
        {isLastAssistant && onRegenerate ? (
          <button
            type="button"
            aria-label="regenerate"
            onClick={() => onRegenerate(message)}
          >
            regenerate
          </button>
        ) : null}
        {isLastUser && onEditAndResend ? (
          <button
            type="button"
            aria-label="edit-and-resend"
            onClick={() => onEditAndResend(message, 'edited via test')}
          >
            edit
          </button>
        ) : null}
      </div>
    );
  },
}));

interface DoubleSessionListProps {
  sessions: ChatSessionInfo[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  isLoading?: boolean;
}

vi.mock('../components/chatbot/SessionList', () => ({
  SessionList: (props: DoubleSessionListProps) => {
    const {
      sessions,
      activeSessionId,
      onSelect,
      onNewChat,
      onRename,
      onDelete,
      isLoading,
    } = props;
    return (
      <div
        data-testid="session-list"
        data-active={activeSessionId}
        data-loading={isLoading ? 'true' : 'false'}
      >
        <button type="button" onClick={onNewChat}>
          new chat
        </button>
        {sessions.map((s) => (
          <div key={s.id} data-testid={`session-${s.id}`}>
            <button type="button" onClick={() => onSelect(s.id)}>
              {`select ${s.id}`}
            </button>
            <button type="button" onClick={() => onRename(s.id, 'Renamed')}>
              {`rename ${s.id}`}
            </button>
            <button type="button" onClick={() => onDelete(s.id)}>
              {`delete ${s.id}`}
            </button>
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock('../components/chatbot/ChatWelcome', () => ({
  ChatWelcome: ({ onPick }: { onPick: (text: string) => void }) => (
    <div data-testid="chat-welcome">
      <button type="button" onClick={() => onPick('Charging cost last 30 days')}>
        pick suggestion
      </button>
    </div>
  ),
}));

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import ChatbotPage from './ChatbotPage';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

/* ─── request capture + routing ──────────────────────────────────────── */
type ReqInit = { method?: string; body?: unknown; signal?: unknown };
interface ReqCall {
  url: string;
  method: string;
  body?: string;
}
let reqCalls: ReqCall[] = [];

function installRequest(opts?: {
  sessions?: ChatSessionInfo[];
  history?: ChatMessage[];
  reply?: { response: string; session_id: string };
}) {
  const sessions = opts?.sessions ?? [];
  const history = opts?.history ?? [];
  const reply = opts?.reply ?? { response: 'Default reply', session_id: 'srv-1' };
  mockedRequest.mockImplementation((url: string, init?: ReqInit) => {
    reqCalls.push({
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    if (url === '/chatbot/sessions') return Promise.resolve(sessions);
    if (url.startsWith('/chatbot/history')) return Promise.resolve(history);
    if (url === '/chatbot' && (init?.method ?? '').toUpperCase() === 'POST') {
      return Promise.resolve(reply);
    }
    if (url.startsWith('/chatbot/sessions/')) return Promise.resolve({});
    return Promise.resolve(undefined);
  });
}

function chatPosts(): Array<Record<string, unknown>> {
  return reqCalls
    .filter((c) => c.url === '/chatbot' && c.method === 'POST')
    .map((c) => JSON.parse(c.body ?? '{}') as Record<string, unknown>);
}

/* ─── SSE stream helpers (byte-for-byte match to writer.go framing) ──── */
function makeReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/* ─── env helpers ────────────────────────────────────────────────────── */
function setMatchMedia(isMobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isMobile && query.includes('max-width'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function session(id: string, over?: Partial<ChatSessionInfo>): ChatSessionInfo {
  return {
    id,
    title: `Chat ${id}`,
    first_message: 'hello',
    message_count: 3,
    last_message_at: '2025-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    ...over,
  };
}

function serverMessage(
  id: number,
  role: 'user' | 'assistant',
  content: string,
): ChatMessage {
  return {
    id,
    session_id: 'srv-1',
    role,
    content,
    created_at: '2025-01-01T00:00:00Z',
  };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/chatbot']}>
        <ToastProvider>
          <ChatbotPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function composer(): HTMLElement {
  return screen.getByRole('textbox');
}

async function typeAndEnter(text: string) {
  const box = composer();
  fireEvent.change(box, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
  });
}

function lastAssistantRow(): HTMLElement {
  const rows = screen
    .getAllByTestId('chat-msg')
    .filter((el) => el.getAttribute('data-role') === 'assistant');
  const row = rows[rows.length - 1];
  if (!row) throw new Error('no assistant row rendered');
  return row;
}

beforeEach(() => {
  reqCalls = [];
  ctrl.aiEnabled = false;
  mockedRequest.mockReset();
  installRequest();
  window.localStorage.clear();
  setMatchMedia(false);
  // jsdom doesn't implement scrollIntoView; the page auto-scrolls the
  // transcript on every new message + during streaming.
  Element.prototype.scrollIntoView = vi.fn();
  // Default fetch throws so a forgotten SSE mock fails loudly.
  globalThis.fetch = vi.fn(async () => {
    throw new Error('fetch not mocked');
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatbotPage — scaffolding, a11y, empty state', () => {
  it('renders the composer, action buttons, live log region, and welcome hero', () => {
    renderPage();

    const box = composer();
    expect(box).toHaveAttribute('aria-label', 'Message');

    // Icon-only send button MUST expose an accessible name.
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeInTheDocument();
    // Empty composer → send disabled.
    expect(send).toBeDisabled();

    const history = screen.getByRole('button', { name: 'History' });
    expect(history).toHaveAttribute('aria-pressed', 'false');

    // The conversation transcript is an aria-live log region.
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(log).toHaveAttribute('aria-live', 'polite');

    // No messages yet → the welcome hero shows, not a blank panel.
    expect(screen.getByTestId('chat-welcome')).toBeInTheDocument();
    expect(screen.queryAllByTestId('chat-msg')).toHaveLength(0);
  });
});

describe('ChatbotPage — history sidebar toggle + persistence', () => {
  it('opens/closes the sidebar, lists sessions, and persists visibility to localStorage', async () => {
    installRequest({ sessions: [session('s1'), session('s2')] });
    renderPage();

    // Hidden by default (desktop, cleaner first-launch focus).
    expect(screen.queryByTestId('session-list')).not.toBeInTheDocument();

    const historyBtn = screen.getByRole('button', { name: 'History' });
    fireEvent.click(historyBtn);

    // Sidebar appears and reflects the loaded sessions.
    await screen.findByTestId('session-list');
    expect(
      await screen.findByRole('button', { name: 'select s1' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'select s2' })).toBeInTheDocument();
    expect(historyBtn).toHaveAttribute('aria-pressed', 'true');
    expect(
      window.localStorage.getItem('teslasync-chatbot-history-visible'),
    ).toBe('true');

    // Toggling off hides it and clears the persisted flag.
    fireEvent.click(historyBtn);
    expect(screen.queryByTestId('session-list')).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem('teslasync-chatbot-history-visible'),
    ).toBe('false');
  });
});

describe('ChatbotPage — AI-off heuristic path', () => {
  it('sends on Enter, POSTs /chatbot with the trimmed message, and reveals the reply', async () => {
    installRequest({
      reply: { response: 'Hello from Helix', session_id: 'srv-1' },
      history: [
        serverMessage(1, 'user', 'Hi'),
        serverMessage(2, 'assistant', 'Hello from Helix'),
      ],
    });
    renderPage();

    await typeAndEnter('  Hi  ');

    await screen.findByText('Hello from Helix');
    expect(screen.queryByTestId('chat-welcome')).not.toBeInTheDocument();

    const posts = chatPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toEqual({ message: 'Hi' });
  });

  it('does NOT submit on Shift+Enter or for a whitespace-only message', async () => {
    installRequest();
    renderPage();

    const box = composer();
    fireEvent.change(box, { target: { value: 'draft line' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter', code: 'Enter', shiftKey: true });
    });
    expect(chatPosts()).toHaveLength(0);

    // Whitespace-only trims to empty → guarded no-op.
    fireEvent.change(box, { target: { value: '    ' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter', code: 'Enter' });
    });
    expect(chatPosts()).toHaveLength(0);
  });

  it('recalls the last user message into an empty composer on ArrowUp', async () => {
    installRequest({
      reply: { response: 'ok', session_id: 'srv-1' },
      history: [
        serverMessage(1, 'user', 'Hi'),
        serverMessage(2, 'assistant', 'ok'),
      ],
    });
    renderPage();

    await typeAndEnter('Hi');
    await screen.findByText('ok');

    const box = composer();
    expect(box).toHaveValue('');
    await act(async () => {
      fireEvent.keyDown(box, { key: 'ArrowUp', code: 'ArrowUp' });
    });
    expect(box).toHaveValue('Hi');
  });

  it('regenerate resends the preceding user message via /chatbot', async () => {
    installRequest({
      reply: { response: 'first reply', session_id: 'srv-1' },
      history: [
        serverMessage(1, 'user', 'Hi'),
        serverMessage(2, 'assistant', 'first reply'),
      ],
    });
    renderPage();

    await typeAndEnter('Hi');
    await screen.findByText('first reply');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'regenerate' }));
    });

    await waitFor(() => expect(chatPosts()).toHaveLength(2));
    expect(chatPosts()[1]).toEqual({ message: 'Hi', session_id: 'srv-1' });
  });

  it('edit-and-resend truncates history and resends the edited text', async () => {
    installRequest({
      reply: { response: 'reply', session_id: 'srv-1' },
      history: [
        serverMessage(1, 'user', 'Hi'),
        serverMessage(2, 'assistant', 'reply'),
      ],
    });
    renderPage();

    await typeAndEnter('Hi');
    await screen.findByText('reply');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'edit-and-resend' }));
    });

    await waitFor(() => expect(chatPosts()).toHaveLength(2));
    expect(chatPosts()[1]).toEqual({
      message: 'edited via test',
      session_id: 'srv-1',
    });
  });
});

describe('ChatbotPage — session management + suggestions', () => {
  it('loads a session on select and resets to the welcome on new chat', async () => {
    installRequest({
      sessions: [session('s1')],
      history: [serverMessage(9, 'assistant', 'restored message')],
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const select = await screen.findByRole('button', { name: 'select s1' });

    await act(async () => {
      fireEvent.click(select);
    });

    // History GET fired for the exact session id (snake_case query param).
    await waitFor(() =>
      expect(
        reqCalls.some((c) => c.url === '/chatbot/history?session_id=s1'),
      ).toBe(true),
    );
    await screen.findByText('restored message');

    // New chat clears the transcript back to the welcome hero.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'new chat' }));
    });
    expect(screen.getByTestId('chat-welcome')).toBeInTheDocument();
    expect(screen.queryByText('restored message')).not.toBeInTheDocument();
  });

  it('rename and delete hit the encoded session endpoints with the right methods', async () => {
    installRequest({ sessions: [session('s1')] });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    await screen.findByRole('button', { name: 'rename s1' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'rename s1' }));
    });
    await waitFor(() =>
      expect(
        reqCalls.some(
          (c) => c.url === '/chatbot/sessions/s1' && c.method === 'PATCH',
        ),
      ).toBe(true),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'delete s1' }));
    });
    await waitFor(() =>
      expect(
        reqCalls.some(
          (c) => c.url === '/chatbot/sessions/s1' && c.method === 'DELETE',
        ),
      ).toBe(true),
    );
  });

  it('picking a suggestion fills the composer without auto-submitting', async () => {
    installRequest();
    renderPage();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'pick suggestion' }));
    });

    expect(composer()).toHaveValue('Charging cost last 30 days');
    expect(chatPosts()).toHaveLength(0);
  });
});

describe('ChatbotPage — AI-on streaming path', () => {
  it('opens an SSE stream to /api/v1/ai/chatbot and accumulates deltas, finalising on done', async () => {
    ctrl.aiEnabled = true;
    installRequest();

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const body =
      sseFrame('tool_call', {
        id: 'fleet-1',
        name: 'query_vehicle_count',
        arguments: {},
      }) +
      sseFrame('tool_result', {
        id: 'fleet-1',
        name: 'query_vehicle_count',
        ok: true,
        data: { count: 1 },
      }) +
      sseFrame('delta', { text: 'Hello ' }) +
      sseFrame('delta', { text: 'world' }) +
      sseFrame('done', { finish_reason: 'stop', usage: { in: 5, out: 3 } });
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({ url: String(input), init });
        return new Response(makeReadableStream([body]), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    ) as unknown as typeof globalThis.fetch;

    renderPage();
    await typeAndEnter('Hi there');

    await waitFor(() => expect(fetchCalls).toHaveLength(1));
    expect(fetchCalls[0].url).toBe('/api/v1/ai/chatbot');
    expect(fetchCalls[0].init?.method).toBe('POST');
    expect(new Headers(fetchCalls[0].init?.headers).get('Accept')).toBe(
      'text/event-stream',
    );
    const sent = JSON.parse(String(fetchCalls[0].init?.body)) as {
      message: string;
      session_id: string;
    };
    expect(sent.message).toBe('Hi there');
    expect(typeof sent.session_id).toBe('string');

    await screen.findByText('Hello world');
    await waitFor(() =>
      expect(lastAssistantRow().getAttribute('data-streaming')).toBe('false'),
    );
    expect(lastAssistantRow()).toHaveTextContent(
      'query_vehicle_count:succeeded',
    );
    expect(lastAssistantRow()).toHaveTextContent('8 tokens');
    // No AI-off fallback POST — the AI path replaces it entirely.
    expect(chatPosts()).toHaveLength(0);
  });

  it('surfaces an SSE `error` frame inline and stops streaming', async () => {
    ctrl.aiEnabled = true;
    installRequest();

    globalThis.fetch = vi.fn(async () => {
      return new Response(
        makeReadableStream([sseFrame('error', { message: 'model overloaded' })]),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    renderPage();
    await typeAndEnter('explain this');

    await screen.findByText(/AI error: model overloaded/);
    await waitFor(() =>
      expect(lastAssistantRow().getAttribute('data-streaming')).toBe('false'),
    );
  });

  it('finalises the placeholder and unblocks retries after a transport-level (5xx) failure', async () => {
    // Regression guard: a non-2xx response flips useAiStream to
    // state='error' WITHOUT emitting an onEvent frame. The page must
    // still finalise the streaming row and clear pendingAiRequest, or
    // every subsequent send is permanently blocked.
    ctrl.aiEnabled = true;
    installRequest();

    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount += 1;
      return new Response('', { status: 500 });
    }) as unknown as typeof globalThis.fetch;

    renderPage();
    await typeAndEnter('ping');

    // The optimistic bubble is finalised (not stuck streaming) and shows
    // the transport error marker.
    await screen.findByText(/AI error: stream_http_500/);
    await waitFor(() =>
      expect(lastAssistantRow().getAttribute('data-streaming')).toBe('false'),
    );
    await waitFor(() => expect(fetchCount).toBe(1));

    // A second send now fires a fresh stream — proof the guard state was
    // cleared rather than latched.
    await typeAndEnter('ping again');
    await waitFor(() => expect(fetchCount).toBe(2));
  });
});
