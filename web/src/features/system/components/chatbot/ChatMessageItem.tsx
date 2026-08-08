import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, Pencil, Check, X } from 'lucide-react';
import { Button, CopyButton, Text, Textarea } from '@/components/ui';
import { Avatar } from '@/components/data-display';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/dateFormat';
import type { ChatMessage } from '@/api/types';
import { HelixEvidenceTrail } from '@/components/ai/HelixEvidenceTrail';
import type { AiToolActivity, AiUsage } from '@/hooks/useAiStream';
import { MarkdownRenderer } from './MarkdownRenderer';

/**
 * Local extension of the wire-level ChatMessage with optional UI-only
 * fields. The page mutates `streamedText` during the typewriter reveal;
 * `isStreaming` controls whether the action row (copy/regenerate) is
 * suppressed and the cursor blinks.
 */
export interface UIChatMessage extends ChatMessage {
  isStreaming?: boolean;
  /** Partial reveal during the typewriter animation. Falls back to content. */
  streamedText?: string;
  /** Privacy-safe tool provenance retained for this assistant turn. */
  aiActivity?: AiToolActivity[];
  /** Token accounting retained for this assistant turn. */
  aiUsage?: AiUsage;
}

interface ChatMessageItemProps {
  message: UIChatMessage;
  /**
   * True only for the LAST assistant message in the list — used to gate
   * the "Regenerate" affordance (we don't let users regenerate a reply
   * in the middle of history).
   */
  isLastAssistant: boolean;
  /**
   * True only for the LAST user message in the list — used to gate the
   * inline edit affordance (editing a mid-history user message would
   * orphan the conversation).
   */
  isLastUser: boolean;
  /**
   * When true, suppress the avatar (consecutive same-role messages). The
   * timestamp is also hidden unless `isLastInGroup` is true.
   */
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  /** Hide all action-row buttons (used while another reply is streaming). */
  actionsDisabled?: boolean;
  onRegenerate?: (message: UIChatMessage) => void;
  onEditAndResend?: (message: UIChatMessage, newText: string) => void;
}

/**
 * Single chat row. Renders a user or assistant bubble with hover-revealed
 * actions (copy on every message; regenerate on the last assistant reply;
 * edit on the last user message).
 */
export function ChatMessageItem({
  message,
  isLastAssistant,
  isLastUser,
  isFirstInGroup,
  isLastInGroup,
  actionsDisabled,
  onRegenerate,
  onEditAndResend,
}: ChatMessageItemProps) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';
  // Guard against a malformed payload where `content` is null/undefined —
  // several paths below call `.trim()` on it, which would otherwise throw.
  const content = message.content ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(content);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(content);
  };

  const submitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === content.trim()) {
      cancelEdit();
      return;
    }
    onEditAndResend?.(message, trimmed);
    setEditing(false);
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  const visibleText = message.streamedText ?? content;
  const showAvatar = isFirstInGroup;
  const showTimestamp = isLastInGroup && !message.isStreaming;
  const showActions = !message.isStreaming && !actionsDisabled && !editing;

  return (
    <div
      className={cn('group flex gap-3', isUser ? 'justify-end' : 'justify-start')}
      data-role={isUser ? 'user' : 'assistant'}
    >
      {!isUser && (
        <div
          className={cn('shrink-0 h-fit mt-1', !showAvatar && 'invisible')}
          aria-hidden={!showAvatar}
        >
          <Avatar kind="bot" size="md" shape="rounded" />
        </div>
      )}

      <div
        className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed border min-w-0',
          isUser
            ? 'max-w-[90%] sm:max-w-[70%] bg-cyan-500/10 border-cyan-500/20'
            : 'max-w-[90%] sm:max-w-[80%] bg-[var(--surface-2)] border-[var(--border-subtle)]',
        )}
        data-print-card
      >
        {editing ? (
          <div className="space-y-2">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={3}
              aria-label={t('chatbot.aria.editMessage', 'Edit message')}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelEdit}
                icon={<X className="h-3.5 w-3.5" />}
              >
                {t('chatbot.actions.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={submitEdit}
                disabled={!draft.trim() || draft.trim() === content.trim()}
                icon={<Check className="h-3.5 w-3.5" />}
              >
                {t('chatbot.actions.saveAndResend', 'Save & resend')}
              </Button>
            </div>
          </div>
        ) : isUser ? (
          <Text as="p" color="primary" className="whitespace-pre-wrap break-words">
            {visibleText}
          </Text>
        ) : (
          <div className="text-[var(--text-primary)] break-words">
            <MarkdownRenderer>{visibleText}</MarkdownRenderer>
            {message.isStreaming && (
              <span
                className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-purple-300/80 motion-safe:animate-pulse"
                aria-hidden="true"
              />
            )}
            <HelixEvidenceTrail
              activity={message.aiActivity ?? []}
              state={message.isStreaming ? 'streaming' : 'done'}
              usage={message.aiUsage}
            />
          </div>
        )}

        {showTimestamp && (
          <Text as="p" size="2xs" color="muted" className="mt-2">
            {formatTime(message.created_at)}
          </Text>
        )}

        {showActions && (
          <div className="mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity">
            <CopyButton
              text={content}
              iconOnly
              variant="ghost"
              size="sm"
              ariaLabel={t('chatbot.aria.copyMessage', 'Copy message')}
            />
            {!isUser && isLastAssistant && onRegenerate && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRegenerate(message)}
                icon={<RotateCw className="h-3.5 w-3.5" />}
                aria-label={t('chatbot.aria.regenerate', 'Regenerate response')}
              >
                {t('chatbot.actions.regenerate', 'Regenerate')}
              </Button>
            )}
            {isUser && isLastUser && onEditAndResend && (
              <Button
                variant="ghost"
                size="sm"
                onClick={startEdit}
                icon={<Pencil className="h-3.5 w-3.5" />}
                aria-label={t('chatbot.aria.edit', 'Edit and resend')}
              >
                {t('chatbot.actions.edit', 'Edit')}
              </Button>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div
          className={cn('shrink-0 h-fit mt-1', !showAvatar && 'invisible')}
          aria-hidden={!showAvatar}
        >
          <Avatar kind="user" size="md" shape="rounded" />
        </div>
      )}
    </div>
  );
}
