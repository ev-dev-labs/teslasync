import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  sendChatMessage,
  getChatHistory,
  getChatSessions,
  renameChatSession,
  deleteChatSession,
} from '@/api/devtools';
import { useMutationToast } from './_toastHelpers';
import type { ChatSessionInfo } from '@/api/types';

/**
 * TanStack Query hooks for the AI assistant.
 *
 * The send-message and history-load paths still go through the existing
 * thin `@/api/devtools` exports used by ChatbotPage's own useMutation.
 * This file adds the session-management mutations the sidebar needs
 * (rename inline, delete with confirmation), plus convenience wrappers
 * around list/history queries so consumers don't have to remember the
 * queryKey shape.
 *
 * Backend wire contract: see `internal/api/chatbot_handler.go` and
 * `internal/api/chatbot_handler_dtos.go` (Sessions / RenameSession /
 * DeleteSession). Routes are registered in router.go under `/chatbot`.
 */

export const chatKeys = {
  all: ['chat'] as const,
  sessions: () => ['chat', 'sessions'] as const,
  history: (sessionId: string) => ['chat', 'history', sessionId] as const,
};

/** Lists chat sessions with metadata (title, message count, last activity). */
export function useChatSessions() {
  return useQuery({
    queryKey: chatKeys.sessions(),
    queryFn: ({ signal }) => getChatSessions({ signal }),
  });
}

/** Loads the message history for a single session. */
export function useChatHistory(sessionId: string) {
  return useQuery({
    queryKey: chatKeys.history(sessionId),
    queryFn: ({ signal }) => getChatHistory(sessionId, { signal }),
    enabled: !!sessionId,
  });
}

/** Renames a chat session inline. Empty string clears the override. */
export function useRenameChatSession() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      renameChatSession(sessionId, title),
    onSuccess: (_data, vars) => {
      qc.setQueryData<ChatSessionInfo[]>(chatKeys.sessions(), (prev) =>
        prev?.map((s) =>
          s.id === vars.sessionId
            ? { ...s, title: vars.title.trim() === '' ? null : vars.title.trim() }
            : s,
        ),
      );
      qc.invalidateQueries({ queryKey: chatKeys.sessions() });
      success('toast.chatbot.rename.success', 'Conversation renamed');
    },
    onError: (e) => error(e, 'toast.chatbot.rename.error', 'Failed to rename conversation'),
  });
}

/** Deletes a chat session and all its messages. */
export function useDeleteChatSession() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: ({ sessionId }: { sessionId: string }) => deleteChatSession(sessionId),
    onSuccess: (_data, vars) => {
      qc.setQueryData<ChatSessionInfo[]>(chatKeys.sessions(), (prev) =>
        prev?.filter((s) => s.id !== vars.sessionId),
      );
      qc.invalidateQueries({ queryKey: chatKeys.sessions() });
      qc.removeQueries({ queryKey: chatKeys.history(vars.sessionId) });
      success('toast.chatbot.delete.success', 'Conversation deleted');
    },
    onError: (e) => error(e, 'toast.chatbot.delete.error', 'Failed to delete conversation'),
  });
}

/**
 * Sends a user message. Exposed as a hook so the page doesn't have to
 * duplicate the mutation wiring; `onSuccess` is left to the caller because
 * ChatbotPage needs to push the assistant reply into local state for the
 * typewriter reveal.
 */
export function useSendChatMessage(opts?: {
  onSuccess?: (data: { response: string; session_id: string }) => void;
  onError?: (err: unknown) => void;
}) {
  return useMutation({
    mutationFn: ({ message, sessionId }: { message: string; sessionId?: string }) =>
      sendChatMessage(message, sessionId),
    onSuccess: opts?.onSuccess,
    onError: opts?.onError,
  });
}
