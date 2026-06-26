// Native parity port of
// web/src/features/system/components/chatbot/ChatMessageItem.tsx.
//
// A single chat row: a user or assistant bubble with hover-revealed actions
// (copy on every message; regenerate on the last assistant reply; inline edit
// on the last user message). All prop/state names, the UIChatMessage UI-only
// extension, the edit draft/submit/cancel state machine, the avatar/timestamp/
// action gating booleans, and the i18n keys + English fallbacks are preserved
// verbatim.
//
// Native adaptations vs. the web source (behaviour / keys kept):
//   - react-i18next `useTranslation` (web L2) -> the shared native-safe
//     `useNativeTranslationFallback` t(key, fallback) hook (no i18n runtime in
//     the parity tree); every t() key + English fallback is copied verbatim.
//   - lucide-react RotateCw/Pencil/Check/X (web L3) -> SemanticIcon glyphs
//     refresh/pencil/confirm/close rendered as text (the canonical native icon
//     bridge); all decorative.
//   - `@/components/ui` Button (web L4) -> an inline ghost/primary Pressable
//     ActionButton (icon glyph + optional label, sm sizing) — no DOM <button>.
//   - `@/components/ui` CopyButton (web L4) -> an icon-only ActionButton wired
//     to an optional `onCopyText` host bridge (navigator.clipboard is
//     browser-only and no clipboard package is wired into the parity tree,
//     conversion rule 7); when no bridge is supplied the button renders the
//     explicit disabled/unavailable state. The bubble body text is ALSO
//     rendered `selectable` so the message can always be long-pressed to copy
//     (the working native copy path, matching the ColorConverter/EntryDrawer
//     parity ports).
//   - `@/components/ui` Textarea (web L4) -> a React Native multiline
//     <TextInput>; web `onChange(e.target.value)` -> `onChangeText`; the web
//     `onKeyDown` Enter(no-shift)->submit / Escape->cancel handler maps to
//     `onKeyPress` reading nativeEvent.key (fires on the hardware-keyboard
//     web/macOS/Windows targets this app also ships to); the explicit
//     Save/Cancel buttons remain the reliable touch affordance.
//   - `@/components/data-display` Avatar (web L5) -> the converted native
//     parity Avatar (kind/size/shape preserved).
//   - `@/lib/cn` cn (web L6) -> dropped; React Native uses StyleSheet.
//   - `@/lib/dateFormat` formatTime (web L7) -> an inline native-safe port
//     (same '—' fallback + 2-digit hour/minute via toLocaleTimeString).
//   - `@/api/types` ChatMessage (web L8) -> the web-parity api/types mirror.
//   - `./MarkdownRenderer` (web L9) -> an inline native-safe AssistantMarkdown:
//     react-markdown + remark-gfm emit DOM elements (browser-only, rule 4), so
//     the assistant text is rendered as whitespace-preserved selectable text —
//     exactly the web MarkdownRenderer's own <Suspense> fallback.
//   - The web hover-reveal action row (`opacity-0 group-hover:opacity-100
//     [@media(pointer:coarse)]:opacity-100`) is always visible on native: a
//     touch device is a coarse pointer, which is the branch that forces
//     opacity-100 on the web too.
//   - The inline blinking caret (`motion-safe:animate-pulse`) -> a static
//     inline purple caret glyph (decorative; the pulse is non-essential and the
//     loop is omitted to keep the parity component side-effect-free).
//   - The web `data-print-card` print hook has no native analogue and is
//     dropped.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import {Avatar} from '../../../../components/data-display/Avatar';
import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import type {ChatMessage} from '../../../../api/types';

/** Universal placeholder returned by the formatter for unrenderable input. */
const FALLBACK = '—';

/** Web CopyButton flips its icon back after 2s. */
const COPIED_RESET_MS = 2000;

// Web lucide icons -> canonical native SemanticIcon glyphs (rendered as text).
const REGENERATE_GLYPH = getSemanticIconDefinition('refresh').glyph;
const EDIT_GLYPH = getSemanticIconDefinition('pencil').glyph;
const CHECK_GLYPH = getSemanticIconDefinition('confirm').glyph;
const CLOSE_GLYPH = getSemanticIconDefinition('close').glyph;
const COPY_GLYPH = getSemanticIconDefinition('copy').glyph;
const COPIED_GLYPH = getSemanticIconDefinition('confirm').glyph;

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- formatTime (web @/lib/dateFormat) — subset this row uses ----------------

function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

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
  /**
   * Native-only host clipboard writer. Replaces the web CopyButton's
   * `navigator.clipboard.writeText` (browser-only). When undefined the Copy
   * button renders the explicit disabled/unavailable state; the bubble text is
   * still `selectable` so it can be long-pressed to copy.
   */
  onCopyText?: (text: string) => void | Promise<void>;
}

// ---- Inline ghost/primary button (web @/components/ui Button) ----------------

interface ActionButtonProps {
  glyph: string;
  label?: string;
  onPress: () => void;
  variant?: 'ghost' | 'primary';
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

function ActionButton({
  glyph,
  label,
  onPress,
  variant = 'ghost',
  disabled = false,
  accessibilityLabel,
  testID,
}: ActionButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.actionBtn,
        isPrimary ? styles.actionBtnPrimary : styles.actionBtnGhost,
        pressed &&
          !disabled &&
          (isPrimary ? styles.actionBtnPrimaryPressed : styles.actionBtnGhostPressed),
        disabled && styles.actionBtnDisabled,
      ]}
      testID={testID}>
      <AppText
        style={[styles.actionGlyph, isPrimary ? styles.actionTextPrimary : styles.actionTextGhost]}
        variant="caption"
        weight="bold">
        {glyph}
      </AppText>
      {label ? (
        <AppText
          style={isPrimary ? styles.actionTextPrimary : styles.actionTextGhost}
          variant="caption"
          weight="semibold">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ---- Native-safe MarkdownRenderer replacement (web ./MarkdownRenderer) -------

function AssistantMarkdown({children, isStreaming}: {children: string; isStreaming?: boolean}) {
  // react-markdown + remark-gfm render HTML elements (browser-only, rule 4), so
  // we render the raw markdown source as whitespace-preserved selectable text —
  // exactly the web MarkdownRenderer's own <Suspense> fallback. The inline
  // streaming caret is appended as a nested (inline) purple glyph.
  return (
    <AppText selectable style={styles.assistantText}>
      {children}
      {isStreaming ? <AppText style={styles.streamCaret}>{'\u258B'}</AppText> : null}
    </AppText>
  );
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
  onCopyText,
}: ChatMessageItemProps) {
  const t = useNativeTranslationFallback();
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const textareaRef = useRef<TextInput>(null);

  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      // Web also moved the caret to the end via setSelectionRange(len, len);
      // RN focuses the field and places the caret per-platform (a controlled
      // `selection` would fight subsequent edits).
      textareaRef.current.focus();
    }
  }, [editing]);

  useEffect(
    () => () => {
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
    },
    [],
  );

  const startEdit = () => {
    setDraft(message.content);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(message.content);
  };

  const submitEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content.trim()) {
      cancelEdit();
      return;
    }
    onEditAndResend?.(message, trimmed);
    setEditing(false);
  };

  const handleEditKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const ne = e.nativeEvent as TextInputKeyPressEventData & {shiftKey?: boolean};
    if (ne.key === 'Enter' && !ne.shiftKey) {
      submitEdit();
    } else if (ne.key === 'Escape') {
      cancelEdit();
    }
  };

  const copyAvailable = onCopyText != null;
  const handleCopy = useCallback(async () => {
    if (onCopyText == null) {
      return;
    }
    try {
      await onCopyText(message.content);
      setCopied(true);
      if (copyResetRef.current) {
        clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Mirrors the web CopyButton's catch (logged there); no native logger.
    }
  }, [onCopyText, message.content]);

  const visibleText = message.streamedText ?? message.content;
  const showAvatar = isFirstInGroup;
  const showTimestamp = isLastInGroup && !message.isStreaming;
  const showActions = !message.isStreaming && !actionsDisabled && !editing;

  const editSubmitDisabled = !draft.trim() || draft.trim() === message.content.trim();

  return (
    <View
      style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}
      testID={isUser ? 'chat-message-user' : 'chat-message-assistant'}>
      {!isUser && (
        <View
          accessibilityElementsHidden={!showAvatar}
          importantForAccessibility={showAvatar ? 'auto' : 'no-hide-descendants'}
          style={[styles.avatarWrap, !showAvatar && styles.hidden]}>
          <Avatar kind="bot" shape="rounded" size="md" />
        </View>
      )}

      <View
        style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
        {editing ? (
          <View style={styles.editStack}>
            <TextInput
              accessibilityLabel={t('chatbot.aria.editMessage', 'Edit message')}
              multiline
              numberOfLines={3}
              onChangeText={setDraft}
              onKeyPress={handleEditKeyPress}
              ref={textareaRef}
              style={styles.textarea}
              textAlignVertical="top"
              value={draft}
            />
            <View style={styles.editActions}>
              <ActionButton
                glyph={CLOSE_GLYPH}
                label={t('chatbot.actions.cancel', 'Cancel')}
                onPress={cancelEdit}
                variant="ghost"
              />
              <ActionButton
                disabled={editSubmitDisabled}
                glyph={CHECK_GLYPH}
                label={t('chatbot.actions.saveAndResend', 'Save & resend')}
                onPress={submitEdit}
                variant="primary"
              />
            </View>
          </View>
        ) : isUser ? (
          <AppText selectable style={styles.userText}>
            {visibleText}
          </AppText>
        ) : (
          <AssistantMarkdown isStreaming={message.isStreaming}>{visibleText}</AssistantMarkdown>
        )}

        {showTimestamp && <AppText style={styles.timestamp}>{formatTime(message.created_at)}</AppText>}

        {showActions && (
          <View style={styles.actionRow}>
            <ActionButton
              accessibilityLabel={t('chatbot.aria.copyMessage', 'Copy message')}
              disabled={!copyAvailable}
              glyph={copied ? COPIED_GLYPH : COPY_GLYPH}
              onPress={handleCopy}
              testID="chat-message-copy"
              variant="ghost"
            />
            {!isUser && isLastAssistant && onRegenerate && (
              <ActionButton
                accessibilityLabel={t('chatbot.aria.regenerate', 'Regenerate response')}
                glyph={REGENERATE_GLYPH}
                label={t('chatbot.actions.regenerate', 'Regenerate')}
                onPress={() => onRegenerate(message)}
                variant="ghost"
              />
            )}
            {isUser && isLastUser && onEditAndResend && (
              <ActionButton
                accessibilityLabel={t('chatbot.aria.edit', 'Edit and resend')}
                glyph={EDIT_GLYPH}
                label={t('chatbot.actions.edit', 'Edit')}
                onPress={startEdit}
                variant="ghost"
              />
            )}
          </View>
        )}
      </View>

      {isUser && (
        <View
          accessibilityElementsHidden={!showAvatar}
          importantForAccessibility={showAvatar ? 'auto' : 'no-hide-descendants'}
          style={[styles.avatarWrap, !showAvatar && styles.hidden]}>
          <Avatar kind="user" shape="rounded" size="md" />
        </View>
      )}
    </View>
  );
}

ChatMessageItem.displayName = 'ChatMessageItem';

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowUser: {
    justifyContent: 'flex-end',
  },
  rowAssistant: {
    justifyContent: 'flex-start',
  },
  avatarWrap: {
    flexShrink: 0,
    marginTop: spacing.xs,
  },
  hidden: {
    opacity: 0,
  },
  bubble: {
    borderRadius: 16,
    borderWidth: 1,
    flexShrink: 1,
    maxWidth: '90%',
    paddingHorizontal: spacing.md + spacing.xs,
    paddingVertical: spacing.md,
  },
  bubbleUser: {
    backgroundColor: 'rgba(34, 211, 238, 0.10)',
    borderColor: 'rgba(34, 211, 238, 0.20)',
  },
  bubbleAssistant: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  editStack: {
    gap: spacing.sm,
  },
  textarea: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  editActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  userText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 22,
  },
  assistantText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 22,
  },
  streamCaret: {
    color: 'rgba(216, 180, 254, 0.8)',
  },
  timestamp: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: spacing.sm,
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  actionBtn: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  actionBtnGhost: {
    backgroundColor: 'transparent',
  },
  actionBtnGhostPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  actionBtnPrimary: {
    backgroundColor: colors.accent,
  },
  actionBtnPrimaryPressed: {
    opacity: 0.85,
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionGlyph: {
    letterSpacing: 0.4,
  },
  actionTextGhost: {
    color: colors.textSecondary,
  },
  actionTextPrimary: {
    color: colors.background,
  },
});
