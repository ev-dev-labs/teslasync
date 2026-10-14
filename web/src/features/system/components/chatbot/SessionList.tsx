import { useState, useRef, useEffect, useId, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, GlassPanel, Icon, Input, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { useDateFormat } from '@/hooks/useDateFormat';
import type { ChatSessionInfo } from '@/api/types';

interface SessionListProps {
  sessions: ChatSessionInfo[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * Sidebar list of past chat sessions.
 *
 * Behaviors:
 *   - "New chat" button always visible at the top.
 *   - Active session gets a highlighted surface.
 *   - Named rename action or double-click → inline rename.
 *   - Enter/Save saves; Escape/Cancel cancels; leaving the editor saves.
 *   - Delete button → ConfirmDialog before mutating.
 *   - Empty state via the shared `<EmptyState>`.
 */
export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  isLoading,
  className,
}: SessionListProps) {
  const { t } = useTranslation();
  const { formatRelative } = useDateFormat();
  const titleId = useId();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ChatSessionInfo | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameButtonsRef = useRef(new Map<string, HTMLButtonElement>());
  const restoreRenameFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    } else if (!renamingId && restoreRenameFocusRef.current) {
      renameButtonsRef.current.get(restoreRenameFocusRef.current)?.focus();
      restoreRenameFocusRef.current = null;
    }
  }, [renamingId]);

  const startRename = (session: ChatSessionInfo) => {
    setRenamingId(session.id);
    // Seed with the *editable* current name (raw title or full first message),
    // never the sidebar's truncated "…" preview or the localized "Untitled"
    // placeholder — otherwise committing would persist that mangled text.
    setRenameDraft(editableTitle(session));
  };

  const commitRename = (restoreFocus = false) => {
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRename(renamingId, trimmed);
    }
    restoreRenameFocusRef.current = restoreFocus ? renamingId : null;
    setRenamingId(null);
  };

  const cancelRename = () => {
    restoreRenameFocusRef.current = renamingId;
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  return (
    <>
      <GlassPanel className={cn('w-72 shrink-0 overflow-hidden flex flex-col', className)}>
        <div className="p-3 border-b border-[var(--glass-border)]">
          <Button
            onClick={onNewChat}
            variant="primary"
            size="sm"
            icon={<Icon icon={Plus} size="md" />}
            wrapLabel
            className="w-full min-h-11 min-w-11 md:min-h-9 md:min-w-0"
          >
            {t('chatbot.newChat', 'New chat')}
          </Button>
        </div>

        <Text
          as="p"
          size="xs"
          weight="semibold"
          color="secondary"
          className="tracking-wider px-4 pt-3 pb-1"
        >
          {t('chatbot.sessions', 'Sessions')}
        </Text>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoading && sessions.length === 0 ? (
            <Text as="p" size="xs" color="muted" className="px-2 py-4 text-center">
              {t('common.loading', 'Loading…')}
            </Text>
          ) : sessions.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<MessageSquare className="h-6 w-6" />}
              message={t('chatbot.noSessions', 'No conversations yet')}
              className="py-8"
            />
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isRenaming = session.id === renamingId;
              return (
                <div
                  key={session.id}
                  className={cn(
                    'flex min-w-0 items-start rounded-lg border transition-colors',
                    isActive
                      ? 'bg-[var(--surface-2)] border-[var(--control-border-hover)]'
                      : 'border-transparent hover:bg-[var(--surface-1)]',
                  )}
                >
                  {isRenaming ? (
                    <div
                      className="min-w-0 w-full p-2 space-y-2"
                      onBlur={(e) => {
                        // Moving to Save/Cancel is still inside this editor.
                        if (!e.currentTarget.contains(e.relatedTarget)) commitRename();
                      }}
                    >
                      <Input
                        ref={renameInputRef}
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        size="sm"
                        className="min-h-11 md:min-h-9"
                        label={t('chatbot.rename.placeholder', 'Conversation name')}
                        placeholder={t('chatbot.rename.placeholder', 'Conversation name')}
                        aria-label={t('chatbot.aria.renameSession', 'Rename conversation')}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          wrapLabel
                          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                          onClick={() => commitRename(true)}
                        >
                          {t('common.save', 'Save')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          wrapLabel
                          className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                          onClick={cancelRename}
                        >
                          {t('common.cancel', 'Cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelect(session.id)}
                      onDoubleClick={() => startRename(session)}
                      className="h-auto min-h-11 min-w-0 flex-1 items-start px-3 py-2 text-start rounded-lg flex-col gap-0.5 md:min-h-9"
                      aria-current={isActive ? 'true' : undefined}
                      title={t('chatbot.aria.doubleClickRename', 'Double-click to rename')}
                    >
                      <Text
                        id={`${titleId}-${session.id}`}
                        size="xs"
                        weight="medium"
                        className="w-full truncate"
                      >
                        {displayTitle(session, t)}
                      </Text>
                      <Text size="xs" color="muted" className="max-w-full break-words">
                        {session.last_message_at
                          ? formatRelative(session.last_message_at)
                          : t('chatbot.session.empty', 'Empty')}
                        {' · '}
                        {t('chatbot.session.messageCount', '{{count}} msgs', {
                          count: session.message_count,
                        })}
                      </Text>
                    </Button>
                  )}

                  {!isRenaming && (
                    <div className="flex shrink-0 gap-1 p-1">
                      <Button
                        ref={(button) => {
                          if (button) renameButtonsRef.current.set(session.id, button);
                          else renameButtonsRef.current.delete(session.id);
                        }}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => startRename(session)}
                        className="min-h-11 min-w-11 px-2 md:min-h-9 md:min-w-9"
                        aria-label={t('chatbot.aria.renameSession', 'Rename conversation')}
                        aria-describedby={`${titleId}-${session.id}`}
                        title={t('chatbot.aria.renameSession', 'Rename conversation')}
                      >
                        <Icon icon={Pencil} size="sm" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(session)}
                        className="min-h-11 min-w-11 px-2 md:min-h-9 md:min-w-9 text-[var(--semantic-danger)]"
                        aria-label={t('chatbot.aria.deleteSession', 'Delete conversation')}
                        aria-describedby={`${titleId}-${session.id}`}
                        title={t('chatbot.aria.deleteSession', 'Delete conversation')}
                      >
                        <Icon icon={Trash2} size="sm" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </GlassPanel>

      <ConfirmDialog
        open={!!pendingDelete}
        title={t('chatbot.delete.title', 'Delete conversation?')}
        message={t(
          'chatbot.delete.message',
          'This will permanently remove this conversation and all its messages.',
        )}
        confirmLabel={t('chatbot.delete.confirm', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="danger"
        details={pendingDelete ? (
          <Text as="p" variant="bodySm" className="whitespace-pre-wrap break-words">
            {editableTitle(pendingDelete) || t('chatbot.session.untitled', 'Untitled conversation')}
          </Text>
        ) : undefined}
        onConfirm={() => {
          if (pendingDelete) {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

/**
 * Resolve the visible title for a session: explicit override → first user
 * message → "Untitled". Truncates to a short, sidebar-friendly width.
 */
function displayTitle(
  session: ChatSessionInfo,
  t: (key: string, defaultValue: string) => string,
): string {
  if (session.title && session.title.trim()) return session.title.trim();
  if (session.first_message && session.first_message.trim()) {
    const first = session.first_message.trim();
    return first.length > 60 ? `${first.slice(0, 60)}…` : first;
  }
  return t('chatbot.session.untitled', 'Untitled conversation');
}

/**
 * Seed value for the inline rename input. Unlike {@link displayTitle}, this
 * returns the *editable* current name — the raw title or the full, untruncated
 * first message — and never the sidebar's truncated "…" preview or the
 * localized "Untitled" placeholder. That keeps a committed rename from
 * persisting an ellipsis-mangled or placeholder title.
 */
function editableTitle(session: ChatSessionInfo): string {
  if (session.title && session.title.trim()) return session.title.trim();
  if (session.first_message && session.first_message.trim()) return session.first_message.trim();
  return '';
}
