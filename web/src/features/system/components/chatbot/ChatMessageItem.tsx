import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, Pencil, Check, X } from 'lucide-react';
import { Button, BUTTON_BASE, BUTTON_VARIANTS, CopyButton, Text, Textarea, IconButton } from '@/components/ui';
import { Avatar } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { ChatLink, ChatMessage } from '@/api/types';
import { HelixEvidenceTrail } from '@/components/ai';
import type { AiStreamState, AiToolActivity, AiUsage } from '@/hooks/useAiStream';
import { MarkdownRenderer } from './MarkdownRenderer';
import { KnowledgeCitations } from './KnowledgeCitations';
import type { KnowledgeEvidence } from './knowledgeEvidence';

/**
 * Local extension of the wire-level ChatMessage with optional UI-only
 * fields. The page mutates `streamedText` during the typewriter reveal;
 * `isStreaming` controls whether the action row (copy/regenerate) is
 * suppressed and the cursor blinks.
 */
export interface UIChatMessage extends ChatMessage {
  isStreaming?: boolean;
  /** Deep-link citations from the send response (fresh turns only). */
  links?: ChatLink[] | null;
  /** Partial reveal during the typewriter animation. Falls back to content. */
  streamedText?: string;
  /** Privacy-safe tool provenance retained for this assistant turn. */
  aiActivity?: AiToolActivity[];
  /** Token accounting retained for this assistant turn. */
  aiUsage?: AiUsage;
  /** Verified retrieval chunks from this response, not model-generated citations. */
  knowledgeEvidence?: KnowledgeEvidence[];
  aiState?: AiStreamState;
  outcome?: 'empty' | 'canceled' | 'error';
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
  onEditAndResend?: (message: UIChatMessage, newText: string) => void | boolean | Promise<void | boolean>;
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
  const { formatTime } = useDateFormat();
  const isUser = message.role === 'user';
  // Guard against a malformed payload where `content` is null/undefined —
  // several paths below call `.trim()` on it, which would otherwise throw.
  const content = message.content ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
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
    if (saving) return;
    setEditing(false);
    setDraft(content);
  };

  const submitEdit = async () => {
    if (saving || actionsDisabled || !onEditAndResend) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === content.trim()) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      const accepted = await onEditAndResend(message, trimmed);
      if (accepted !== false) setEditing(false);
    } catch {
      // The caller owns error feedback; keep the raw revision recoverable.
    } finally {
      setSaving(false);
    }
  };

  const handleEditKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitEdit();
    } else if (e.key === 'Escape') {
      if (!saving) {
        e.preventDefault();
        cancelEdit();
      }
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
      data-app-part="conversation-message"
      data-app-message-state={message.isStreaming ? 'streaming' : message.outcome ?? 'complete'}
      data-app-revision-state={editing ? saving ? 'pending' : 'editing' : undefined}
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
        data-app-part="card conversation-bubble"
        data-app-card-kind="conversation"
        className={cn(
          'rounded-shape-lg px-d-pad-x py-d-pad-y text-d-base border min-w-0',
          isUser
            ? 'max-w-[90%] sm:max-w-[70%] bg-theme-accent/10 border-theme-accent/20'
            : 'max-w-[90%] sm:max-w-[80%] bg-[var(--surface-2)] border-[var(--border-subtle)]',
        )}
        data-print-card
      >
        {editing ? (
          <div data-app-part="field conversation-revision" data-app-form-section className="space-y-2">
            <Textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleEditKeyDown}
              readOnly={saving}
              rows={3}
              size="auto"
              aria-label={t('chatbot.aria.editMessage', 'Edit message')}
            />
            <div data-app-part="conversation-revision-actions" className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={cancelEdit}
                disabled={saving}
                wrapLabel
                className="min-h-11 min-w-11 md:min-h-8 md:min-w-0"
                icon={<X className="h-3.5 w-3.5" />}
              >
                {t('chatbot.actions.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void submitEdit()}
                disabled={saving || actionsDisabled || !draft.trim() || draft.trim() === content.trim()}
                aria-busy={saving || undefined}
                className="min-h-11 min-w-11 md:min-h-8 md:min-w-0"
                wrapLabel
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
          <div data-app-part="conversation-answer" className="text-[var(--text-primary)] break-words">
            <MarkdownRenderer>{visibleText}</MarkdownRenderer>
            {message.isStreaming && (
              <span
                className="inline-block w-1.5 h-4 ml-0.5 align-text-bottom bg-[var(--text-muted)]"
                aria-hidden="true"
              />
            )}
            <HelixEvidenceTrail
              activity={message.aiActivity ?? []}
              state={message.isStreaming ? 'streaming' : message.aiState ?? 'done'}
              usage={message.aiUsage}
            />
            {message.outcome && (
              <AlertBanner
                data-app-part="feedback conversation-outcome"
                data-app-outcome={message.outcome}
                variant={message.outcome === 'error' ? 'danger' : 'warning'}
                role="status"
                className="mt-3"
              >
                {message.outcome === 'empty'
                  ? t('chatbot.noOutput', 'No response text was returned. You can retry or edit your message.')
                  : message.outcome === 'canceled'
                    ? t('chatbot.canceled', 'Response stopped. Any partial text is incomplete.')
                    : t('chatbot.responseFailed', 'Response failed. You can retry or edit your message.')}
              </AlertBanner>
            )}
            {!message.isStreaming && (
              <KnowledgeCitations evidence={message.knowledgeEvidence ?? []} answer={content} />
            )}
            {(message.links?.length ?? 0) > 0 && !message.isStreaming && (
              <div data-app-part="conversation-citations" className="mt-2 flex flex-wrap gap-1.5" aria-label={t('chatbot.citations', 'Sources')}>
                {(message.links ?? []).map((link) => (
                  <a
                    key={link.path}
                    href={link.path}
                    data-app-part="button conversation-citation"
                    data-app-variant="secondary"
                    data-app-size="auto"
                    className={cn(
                      BUTTON_BASE,
                      BUTTON_VARIANTS.secondary,
                      'min-h-11 max-w-full whitespace-normal break-words px-d-pad-x py-d-pad-y text-d-base',
                    )}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {showTimestamp && (
          <Text as="p" data-app-part="conversation-timestamp" variant="caption" className="mt-2">
            {formatTime(message.created_at)}
          </Text>
        )}

        {showActions && (
          <div data-app-part="conversation-actions" className="mt-2 flex flex-wrap items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100 transition-opacity">
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
                className="min-h-11 min-w-11 md:min-h-8 md:min-w-0"
                wrapLabel
                icon={<RotateCw className="h-3.5 w-3.5" />}
                aria-label={t('chatbot.aria.regenerate', 'Regenerate response')}
              >
                {t('chatbot.actions.regenerate', 'Regenerate')}
              </Button>
            )}
            {isUser && isLastUser && onEditAndResend && (
              <IconButton icon={<Pencil className="h-3.5 w-3.5" />} label={t('chatbot.actions.edit', 'Edit')} onClick={startEdit} aria-label={t('chatbot.aria.edit', 'Edit and resend')} />
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
