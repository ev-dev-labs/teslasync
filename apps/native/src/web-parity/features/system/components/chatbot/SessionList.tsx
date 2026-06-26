// SessionList — React Native parity port of
// web/src/features/system/components/chatbot/SessionList.tsx.
//
// Sidebar list of past chat sessions. Behaviors preserved 1:1:
//   - "New chat" button always visible at the top.
//   - Active session gets a highlighted (violet) surface.
//   - Inline rename of a row title (the web double-click affordance maps to a
//     long-press on native; Enter / blur saves, Escape — hardware keyboards
//     only — cancels).
//   - Delete button → ConfirmDialog before mutating.
//   - Empty state via an inline message-bubble glyph + message.
//
// Browser-only dependencies are reduced explicitly and documented in the
// .parity.json sidecar:
//   - react-i18next useTranslation (web L2): native-safe
//     useNativeTranslationFallback returning t(key, default, params?) that
//     interpolates i18next-style {{count}} placeholders — every translation key
//     + intent preserved.
//   - lucide-react MessageSquare / Plus / Trash2 (web L3): decorative AppText
//     glyphs (💬 / + / 🗑); the web aria-hidden becomes
//     importantForAccessibility="no".
//   - @/components/ui Button / Input / GlassPanel (web L4): GlassPanel uses the
//     existing native primitive; Button + Input are reproduced as local
//     native-safe Pressable / TextInput equivalents (the sibling-port
//     precedent).
//   - @/components/feedback EmptyState (web L5): reproduced inline because the
//     native EmptyState takes title+message while the web call passes a single
//     message + icon — an inline glyph+message block matches the source 1:1.
//   - @/lib/cn (web L6): dropped — native styling is StyleSheet + tokens.
//   - @/lib/dateFormat formatRelative (web L7): ported verbatim ("—" / "just
//     now" / "{n}m ago" / "{n}h ago" / "{n}d ago" / localized date) with a
//     guarded toLocaleDateString fallback for reduced-Intl RN runtimes.
//   - DOM KeyboardEvent / HTMLInputElement (web L1, L45, L73): replaced by an RN
//     TextInput ref + onKeyPress(TextInputKeyPressEventData). The web
//     onDoubleClick rename trigger has no native analog and maps to onLongPress.

import React, {useEffect, useRef, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import {ConfirmDialog} from '../../../../components/ui/ConfirmDialog';
import type {ChatSessionInfo} from '../../../../api/types';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValue: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue, params) =>
    interpolate(defaultValue, params),
  ).current;
}

// ── relative-time formatter (native-safe port of @/lib/dateFormat formatRelative) ──
// Verbatim port: "—" for nullish/invalid, "just now" < 60s, "{n}m ago" < 60m,
// "{n}h ago" < 24h, "{n}d ago" < 7d, otherwise a localized "Mon D, YYYY" date
// (toLocaleDateString) guarded for reduced-Intl RN runtimes.
function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  try {
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d.toDateString();
  }
}

// Decorative glyphs standing in for the lucide line icons.
const MESSAGE_GLYPH = '\uD83D\uDCAC'; // 💬 MessageSquare
const PLUS_GLYPH = '+'; // Plus
const TRASH_GLYPH = '\uD83D\uDDD1'; // 🗑 Trash2

export interface SessionListProps {
  sessions: ChatSessionInfo[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  isLoading?: boolean;
  /**
   * Accepted for source compatibility with the web prop. Native layout is
   * driven by StyleSheet + tokens, so the Tailwind class string is ignored.
   */
  className?: string;
}

/**
 * Sidebar list of past chat sessions.
 *
 * Behaviors:
 *   - "New chat" button always visible at the top.
 *   - Active session gets a highlighted surface.
 *   - Long-press a row title → inline rename (Enter/blur saves, Esc cancels).
 *   - Delete button → ConfirmDialog before mutating.
 *   - Empty state with a message-bubble glyph.
 */
export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  isLoading,
}: SessionListProps) {
  const t = useNativeTranslationFallback();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<ChatSessionInfo | null>(
    null,
  );
  const renameInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingId]);

  const startRename = (session: ChatSessionInfo) => {
    setRenamingId(session.id);
    setRenameDraft(displayTitle(session, t));
  };

  const commitRename = () => {
    if (!renamingId) {
      return;
    }
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

  const handleRenameKeyDown = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ) => {
    if (e.nativeEvent.key === 'Enter') {
      commitRename();
    } else if (e.nativeEvent.key === 'Escape') {
      cancelRename();
    }
  };

  return (
    <>
      <GlassPanel testID="session-list-root" style={styles.panel}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel={t('chatbot.newChat', 'New Chat')}
            accessibilityRole="button"
            onPress={onNewChat}
            style={({pressed}) => [
              styles.newChatButton,
              pressed && styles.newChatButtonPressed,
            ]}
            testID="session-list-new-chat">
            <AppText
              importantForAccessibility="no"
              style={styles.newChatGlyph}
              weight="semibold">
              {PLUS_GLYPH}
            </AppText>
            <AppText style={styles.newChatLabel} weight="semibold">
              {t('chatbot.newChat', 'New Chat')}
            </AppText>
          </Pressable>
        </View>

        <AppText style={styles.sectionLabel}>
          {t('chatbot.sessions', 'Sessions')}
        </AppText>

        <ScrollView
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          style={styles.list}>
          {isLoading && sessions.length === 0 ? (
            <AppText
              style={styles.loading}
              testID="session-list-loading"
              tone="muted">
              {t('common.loading', 'Loading…')}
            </AppText>
          ) : sessions.length === 0 ? (
            <View style={styles.empty} testID="session-list-empty">
              <AppText importantForAccessibility="no" style={styles.emptyGlyph}>
                {MESSAGE_GLYPH}
              </AppText>
              <AppText style={styles.emptyMessage} tone="muted">
                {t('chatbot.noSessions', 'No conversations yet')}
              </AppText>
            </View>
          ) : (
            sessions.map(session => {
              const isActive = session.id === activeSessionId;
              const isRenaming = session.id === renamingId;
              return (
                <View
                  key={session.id}
                  style={[
                    styles.row,
                    isActive ? styles.rowActive : styles.rowInactive,
                  ]}
                  testID={`session-list-row-${session.id}`}>
                  {isRenaming ? (
                    <View style={styles.renameWrap}>
                      <TextInput
                        accessibilityLabel={t(
                          'chatbot.aria.renameSession',
                          'Rename conversation',
                        )}
                        autoFocus
                        onBlur={commitRename}
                        onChangeText={setRenameDraft}
                        onKeyPress={handleRenameKeyDown}
                        onSubmitEditing={commitRename}
                        placeholderTextColor={colors.textMuted}
                        ref={renameInputRef}
                        selectTextOnFocus
                        style={styles.renameInput}
                        testID="session-list-rename-input"
                        value={renameDraft}
                      />
                    </View>
                  ) : (
                    <Pressable
                      accessibilityHint={t(
                        'chatbot.aria.doubleClickRename',
                        'Double-click to rename',
                      )}
                      accessibilityRole="button"
                      accessibilityState={{selected: isActive}}
                      onLongPress={() => startRename(session)}
                      onPress={() => onSelect(session.id)}
                      style={({pressed}) => [
                        styles.selectButton,
                        pressed && !isActive && styles.rowPressed,
                      ]}
                      testID={`session-list-select-${session.id}`}>
                      <AppText
                        numberOfLines={1}
                        style={[
                          styles.title,
                          isActive ? styles.titleActive : styles.titleInactive,
                        ]}>
                        {displayTitle(session, t)}
                      </AppText>
                      <AppText
                        numberOfLines={1}
                        style={styles.subtitle}
                        tone="muted">
                        {session.last_message_at
                          ? formatRelative(session.last_message_at)
                          : t('chatbot.session.empty', 'Empty')}
                        {' · '}
                        {t('chatbot.session.messageCount', '{{count}} msgs', {
                          count: session.message_count,
                        })}
                      </AppText>
                    </Pressable>
                  )}

                  {!isRenaming && (
                    <Pressable
                      accessibilityLabel={t(
                        'chatbot.aria.deleteSession',
                        'Delete conversation',
                      )}
                      accessibilityRole="button"
                      hitSlop={6}
                      onPress={() => setPendingDelete(session)}
                      style={({pressed}) => [
                        styles.deleteButton,
                        pressed && styles.deleteButtonPressed,
                      ]}
                      testID={`session-list-delete-${session.id}`}>
                      <AppText
                        importantForAccessibility="no"
                        style={styles.deleteGlyph}>
                        {TRASH_GLYPH}
                      </AppText>
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </ScrollView>
      </GlassPanel>

      <ConfirmDialog
        cancelLabel={t('common.cancel', 'Cancel')}
        confirmLabel={t('chatbot.delete.confirm', 'Delete')}
        message={t(
          'chatbot.delete.message',
          'This will permanently remove this conversation and all its messages.',
        )}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }
        }}
        open={!!pendingDelete}
        title={t('chatbot.delete.title', 'Delete conversation?')}
        variant="danger"
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
  if (session.title && session.title.trim()) {
    return session.title.trim();
  }
  if (session.first_message && session.first_message.trim()) {
    const first = session.first_message.trim();
    return first.length > 60 ? `${first.slice(0, 60)}…` : first;
  }
  return t('chatbot.session.untitled', 'Untitled conversation');
}

const styles = StyleSheet.create({
  panel: {
    width: 288,
    flexShrink: 0,
    overflow: 'hidden',
  },
  header: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.accent,
  },
  newChatButtonPressed: {
    opacity: 0.82,
  },
  newChatGlyph: {
    color: colors.background,
    fontSize: typography.body,
    lineHeight: typography.body + 2,
  },
  newChatLabel: {
    color: colors.background,
    fontSize: typography.caption + 1,
  },
  sectionLabel: {
    fontSize: typography.caption,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.textSecondary,
    paddingHorizontal: 16,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  list: {
    flexGrow: 1,
    flexShrink: 1,
  },
  listContent: {
    padding: spacing.sm,
    gap: spacing.xs,
  },
  loading: {
    fontSize: typography.caption,
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: spacing.sm,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 32,
  },
  emptyGlyph: {
    fontSize: 24,
    lineHeight: 28,
    color: colors.textMuted,
  },
  emptyMessage: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
  row: {
    borderRadius: 12,
    borderWidth: 1,
  },
  rowActive: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.violetBorder,
  },
  rowInactive: {
    borderColor: 'transparent',
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  renameWrap: {
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  renameInput: {
    flex: 1,
    minHeight: 32,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontSize: typography.caption + 1,
  },
  selectButton: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    paddingRight: 32,
    borderRadius: 12,
  },
  title: {
    fontSize: typography.caption,
    fontWeight: '500',
  },
  titleActive: {
    color: colors.violet,
  },
  titleInactive: {
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 10,
    lineHeight: 14,
  },
  deleteButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    padding: 6,
    borderRadius: 8,
  },
  deleteButtonPressed: {
    backgroundColor: colors.dangerSurface,
  },
  deleteGlyph: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textMuted,
  },
});
