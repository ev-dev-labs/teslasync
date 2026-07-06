// useChat hook-layer tests.
//
// useChat.ts is the AI-assistant TanStack Query surface: session list +
// per-session history queries, plus the rename / delete / send mutations
// the chatbot sidebar and composer drive.
//
// These tests exercise the contract each export exposes — the exact
// request path (no /api/v1 prefix, snake_case query params, encodeURIComponent
// on path ids), method + body shape, AbortSignal threading, the enabled-guard
// on the history query, the optimistic sessions-cache edits (trim on rename,
// null on whitespace-only clear, drop + history eviction on delete), the
// caller callbacks on send, and the default error-toast fallback — without
// standing up the whole ChatbotPage.
//
// We mock `@/api/client`'s `request` (not `@/api/devtools`) so the real
// devtools URL/method/body construction is verified end-to-end. `request` is
// reached via a relative `./client` import inside devtools.ts, which resolves
// to the same module id as `@/api/client`, so the mock intercepts it.
//
// Sibling-of-source location is mandatory: the elevation gate matches
// `api/hooks/useChat` as a contiguous path substring, which a __tests__/
// subdir would interrupt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import type { ChatSessionInfo, ChatMessage } from '@/api/types';
import {
  chatKeys,
  useChatSessions,
  useChatHistory,
  useRenameChatSession,
  useDeleteChatSession,
  useSendChatMessage,
} from './useChat';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// Fresh QueryClient + ToastProvider per hook render. Returning the client lets
// the mutation tests seed and then assert the optimistic sessions cache
// directly. `retry: false` keeps error paths synchronous.
function setup() {
  const qc = new QueryClient({
    defaultOptions: {
      // gcTime: Infinity keeps queries we seed via setQueryData (with no
      // mounted observer) alive for the duration of the test — otherwise
      // act()'s timer flush garbage-collects them before we can assert the
      // optimistic cache edits. Each test builds a fresh client, so nothing
      // leaks across tests.
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return { qc, wrapper };
}

const baseSession: ChatSessionInfo = {
  id: 's1',
  title: null,
  first_message: 'How far did I drive?',
  message_count: 4,
  last_message_at: '2025-06-20T12:00:00Z',
  created_at: '2025-06-20T11:00:00Z',
};

const baseMessage: ChatMessage = {
  id: 1,
  session_id: 's1',
  role: 'user',
  content: 'How far did I drive?',
  created_at: '2025-06-20T11:00:00Z',
};

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('chatKeys', () => {
  it('exposes a stable root and derived key tuples', () => {
    expect(chatKeys.all).toEqual(['chat']);
    expect(chatKeys.sessions()).toEqual(['chat', 'sessions']);
    expect(chatKeys.history('abc')).toEqual(['chat', 'history', 'abc']);
  });

  it('scopes history keys per session id', () => {
    expect(chatKeys.history('a')).not.toEqual(chatKeys.history('b'));
    expect(chatKeys.history('a')[2]).toBe('a');
  });
});

describe('useChatSessions', () => {
  it('GETs /chatbot/sessions with an abort signal and surfaces the list', async () => {
    mockedRequest.mockResolvedValueOnce([
      baseSession,
      { ...baseSession, id: 's2' },
    ]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useChatSessions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/chatbot/sessions');
    // resilience.ts pattern: React Query threads its AbortSignal so an
    // in-flight sidebar fetch is cancelled on unmount / navigation.
    expect(opts).toHaveProperty('signal');
  });

  it('surfaces request errors as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useChatSessions(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('useChatHistory', () => {
  it('GETs /chatbot/history?session_id=<id> with a signal and returns messages', async () => {
    mockedRequest.mockResolvedValueOnce([
      baseMessage,
      { ...baseMessage, id: 2, role: 'assistant', content: 'You drove 42 km.' },
    ]);
    const { wrapper } = setup();
    const { result } = renderHook(() => useChatHistory('s_1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/chatbot/history?session_id=s_1');
    expect(opts).toHaveProperty('signal');
  });

  it('is disabled (fires no request) when sessionId is empty', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useChatHistory(''), { wrapper });

    // Give the query a tick — the enabled:!!sessionId guard must keep it idle.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isPending).toBe(true);
  });
});

describe('useRenameChatSession', () => {
  it('PATCHes /chatbot/sessions/{id} and trims the title in the optimistic cache', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ChatSessionInfo[]>(chatKeys.sessions(), [
      { ...baseSession, id: 's1', title: null },
      { ...baseSession, id: 's2', title: 'Untouched' },
    ]);
    mockedRequest.mockResolvedValueOnce({ id: 's1', title: 'New Title' });

    const { result } = renderHook(() => useRenameChatSession(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: 's1', title: '  New Title  ' });
    });

    const sessions = qc.getQueryData<ChatSessionInfo[]>(chatKeys.sessions());
    expect(sessions?.find((s) => s.id === 's1')?.title).toBe('New Title');
    // Sibling rows are left untouched by the targeted map.
    expect(sessions?.find((s) => s.id === 's2')?.title).toBe('Untouched');

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/chatbot/sessions/s1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body as string)).toEqual({ title: '  New Title  ' });
  });

  it('clears the override (null) when renamed to a whitespace-only string', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ChatSessionInfo[]>(chatKeys.sessions(), [
      { ...baseSession, id: 's1', title: 'Old name' },
    ]);
    mockedRequest.mockResolvedValueOnce({ id: 's1', title: '' });

    const { result } = renderHook(() => useRenameChatSession(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: 's1', title: '   ' });
    });

    const sessions = qc.getQueryData<ChatSessionInfo[]>(chatKeys.sessions());
    expect(sessions?.[0].title).toBeNull();
  });

  it('URL-encodes the session id in the PATCH path', async () => {
    const { wrapper } = setup();
    mockedRequest.mockResolvedValueOnce({ id: 'a/b', title: 'x' });

    const { result } = renderHook(() => useRenameChatSession(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: 'a/b', title: 'x' });
    });

    expect(mockedRequest.mock.calls[0][0]).toBe('/chatbot/sessions/a%2Fb');
  });

  it('rejects and flags isError (routed to the error toast) on failure', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('rename nope'));

    const { result } = renderHook(() => useRenameChatSession(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ sessionId: 's1', title: 'x' }),
      ).rejects.toThrow('rename nope');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useDeleteChatSession', () => {
  it('DELETEs /chatbot/sessions/{id}, drops the row, and evicts its history', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData<ChatSessionInfo[]>(chatKeys.sessions(), [
      { ...baseSession, id: 's1' },
      { ...baseSession, id: 's2' },
    ]);
    qc.setQueryData<ChatMessage[]>(chatKeys.history('s1'), [baseMessage]);
    mockedRequest.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useDeleteChatSession(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ sessionId: 's1' });
    });

    const sessions = qc.getQueryData<ChatSessionInfo[]>(chatKeys.sessions());
    expect(sessions?.map((s) => s.id)).toEqual(['s2']);
    // History cache for the deleted session is removed, not just invalidated.
    expect(qc.getQueryData(chatKeys.history('s1'))).toBeUndefined();

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/chatbot/sessions/s1');
    expect(opts.method).toBe('DELETE');
  });

  it('rejects and flags isError on failure', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('delete nope'));

    const { result } = renderHook(() => useDeleteChatSession(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ sessionId: 's1' }),
      ).rejects.toThrow('delete nope');
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useSendChatMessage', () => {
  it('POSTs /chatbot with message + session_id and invokes the caller onSuccess', async () => {
    const onSuccess = vi.fn();
    const { wrapper } = setup();
    mockedRequest.mockResolvedValueOnce({ response: 'You drove 42 km.', session_id: 's9' });

    const { result } = renderHook(() => useSendChatMessage({ onSuccess }), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ message: 'hello', sessionId: 's9' });
    });

    const [url, opts] = mockedRequest.mock.calls[0];
    expect(url).toBe('/chatbot');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body as string)).toEqual({ message: 'hello', session_id: 's9' });
    // TanStack invokes onSuccess as (data, variables, context); the hook's
    // public contract is that the first arg is the ChatResponse.
    expect(onSuccess.mock.calls[0][0]).toEqual({ response: 'You drove 42 km.', session_id: 's9' });
  });

  it('omits session_id from the body when the caller does not supply one', async () => {
    const { wrapper } = setup();
    mockedRequest.mockResolvedValueOnce({ response: 'ok', session_id: 's_new' });

    const { result } = renderHook(() => useSendChatMessage(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ message: 'first message' });
    });

    const body = JSON.parse(mockedRequest.mock.calls[0][1].body as string);
    expect(body).toEqual({ message: 'first message' });
    expect(body).not.toHaveProperty('session_id');
  });

  it('invokes the caller-provided onError and suppresses the fallback toast', async () => {
    const onError = vi.fn();
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('send failed'));

    const { result } = renderHook(() => useSendChatMessage({ onError }), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ message: 'hi' }),
      ).rejects.toThrow('send failed');
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    // Caller owns feedback → the hook must NOT also raise its own toast.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falls back to an assertive error toast when the caller omits onError', async () => {
    const { wrapper } = setup();
    mockedRequest.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => useSendChatMessage(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ message: 'hi' }),
      ).rejects.toThrow('offline');
    });

    // A failed send is never silent: the default error toast renders with
    // role="alert" (assertive live-region) so screen readers announce it.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
