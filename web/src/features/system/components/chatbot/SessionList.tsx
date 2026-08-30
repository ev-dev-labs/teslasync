import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, GlassPanel, Input, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/dateFormat';
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
 *   - Double-click a row title → inline rename (Enter saves, Esc cancels).
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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ChatSessionInfo | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const startRename = (session: ChatSessionInfo) => {
    setRenamingId(session.id);
    // Seed with the *editable* current name (raw title or full first message),
    // never the sidebar's truncated "…" preview or the localized "Untitled"
    // placeholder — otherwise committing would persist that mangled text.
    setRenameDraft(editableTitle(session));
  };

  const commitRename = () => {
    if (!renamingId) return;
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRename(renamingId, trimmed);
    }
    setRenamingId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft('');
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
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
            icon={<Plus className="h-4 w-4" />}
            className="w-full"
          >
            {t('chatbot.newChat', 'New Chat')}
          </Button>
        </div>

        <Text
          as="p"
          size="xs"
          weight="semibold"
          color="secondary"
          className="uppercase tracking-wider px-4 pt-3 pb-1"
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
                    'group relative rounded-lg border transition-colors',
                    isActive
                      ? 'bg-[var(--surface-2)] border-purple-500/30'
                      : 'border-transparent hover:bg-[var(--surface-1)]',
                  )}
                >
                  {isRenaming ? (
                    <div className="p-2 flex items-center gap-1">
                      <Input
                        ref={renameInputRef}
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={handleRenameKeyDown}
                        onBlur={commitRename}
                        size="sm"
                        placeholder={t('chatbot.rename.placeholder', 'Conversation name')}
                        aria-label={t('chatbot.aria.renameSession', 'Rename conversation')}
                      />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelect(session.id)}
                      onDoubleClick={() => startRename(session)}
                      className={cn(
                        'h-auto w-full items-start px-3 py-2 pr-8 text-left rounded-lg flex-col gap-0.5',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/40',
                      )}
                      aria-current={isActive ? 'true' : undefined}
                      title={t('chatbot.aria.doubleClickRename', 'Double-click to rename')}
                    >
                      <Text
                        size="xs"
                        weight="medium"
                        className={cn(
                          'truncate',
                          isActive ? 'text-purple-200' : 'text-[var(--text-primary)]',
                        )}
                      >
                        {displayTitle(session, t)}
                      </Text>
                      <Text size="2xs" color="muted" className="truncate">
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(session);
                      }}
                      className={cn(
                        'absolute top-1.5 right-1.5 h-auto p-1.5 rounded',
                        'opacity-0 group-hover:opacity-100 focus:opacity-100',
                        'text-[var(--text-muted)] hover:text-rose-300 hover:bg-rose-500/10',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40',
                      )}
                      aria-label={t('chatbot.aria.deleteSession', 'Delete conversation')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
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
