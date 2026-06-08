//
//  ChatMessageItem.Views.swift
//  TeslaSync — P4 feature view · 0219 · ChatMessageItem (Apple)
//
//  The presentational subviews composed by `ChatMessageItem`: the row scaffold
//  (avatar + bubble + push spacer, mirrored per role), the bubble surface, the
//  rendered message (plain user text vs. assistant markdown with the streaming
//  cursor), the inline editor, the hover-equivalent action row (copy / regenerate /
//  edit), and the loading / empty / error chrome plus the freshness banner. All
//  consume the P1/S10 facade and the shared P1/S9 tokens + components — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the user bubble uses the brand
//  `accent` (the cyan the web `cyan-500` maps to) at the web's 10%/20% fill/stroke;
//  the assistant bubble uses the elevated `surface` + `border` tokens (web
//  `--surface-2` / `--border-subtle`); the streaming cursor uses the brand purple
//  `chartSeriesPower` (web `purple-300`).
//

import SwiftUI

// MARK: - Row scaffold + bubble surface

/// Bubble fill/stroke per role — the native mirror of the web bubble classes.
enum ChatBubbleStyle {
    static func background(isUser: Bool) -> Color {
        isUser ? Color.TS.accent.opacity(0.10) : Color.TS.surface
    }

    static func border(isUser: Bool) -> Color {
        isUser ? Color.TS.accent.opacity(0.22) : Color.TS.border
    }
}

/// One chat row: avatar + bubble + a push spacer, mirrored so user rows trail and
/// assistant rows lead (web `justify-end` / `justify-start`).
struct ChatRowContainer<Content: View>: View {
    let isUser: Bool
    let avatarRole: ChatRole
    let avatarVisible: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            if isUser {
                Spacer(minLength: TSSpacing.x4xl)
                content()
                ChatAvatar(role: avatarRole, visible: avatarVisible)
            } else {
                ChatAvatar(role: avatarRole, visible: avatarVisible)
                content()
                Spacer(minLength: TSSpacing.x4xl)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
    }
}

/// The rounded bubble surface (web `rounded-2xl px-4 py-3 border`), capped so it never
/// spans the full row width (web `max-w-[70-90%]`).
struct ChatBubble<Content: View>: View {
    let isUser: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(maxWidth: 420, alignment: .leading)
            .background(
                ChatBubbleStyle.background(isUser: isUser),
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(ChatBubbleStyle.border(isUser: isUser), lineWidth: 1)
            )
    }
}

/// The grouped role avatar (web `Avatar kind="bot|user" shape="rounded"`). Reserves
/// its footprint when hidden (web `invisible`) so consecutive rows stay aligned.
struct ChatAvatar: View {
    let role: ChatRole
    let visible: Bool

    private var tint: Color {
        role == .assistant ? Color.TS.accent : Color.TS.textSecondary
    }

    private var label: String {
        role == .assistant
            ? ChatStrings.string("chat.avatar.assistant", "AI assistant")
            : ChatStrings.string("chat.avatar.user", "You")
    }

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(tint.opacity(0.18))
            .frame(width: 28, height: 28)
            .overlay(
                Image(systemName: role == .assistant ? "sparkles" : "person.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tint)
            )
            .padding(.top, 2)
            .opacity(visible ? 1 : 0)
            .accessibilityHidden(!visible)
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Data row (web non-editing + editing render)

/// The resolved bubble — the rendered message (or inline editor) plus the action row.
struct ChatMessageDataRow: View {
    @Bindable var model: ChatMessageModel

    private var resolved: ChatMessageResolved {
        model.resolved
    }

    var body: some View {
        ChatRowContainer(
            isUser: resolved.isUser,
            avatarRole: resolved.isUser ? .user : .assistant,
            avatarVisible: resolved.showAvatar
        ) {
            ChatBubble(isUser: resolved.isUser) {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    if model.editing {
                        ChatEditView(model: model)
                    } else {
                        ChatRenderedMessage(resolved: resolved)
                    }
                    if resolved.actionsAllowed, !model.editing {
                        ChatActionRow(model: model)
                    }
                }
            }
        }
    }
}

/// The non-editing message body — plain user text (web `whitespace-pre-wrap`) or
/// assistant markdown with the streaming cursor — plus the last-in-group timestamp,
/// collapsed into one VoiceOver element.
struct ChatRenderedMessage: View {
    let resolved: ChatMessageResolved

    private var timeText: String {
        ChatFormat.time(resolved.message.createdAt)
    }

    private var roleLabel: String {
        resolved.isUser
            ? ChatStrings.string("chat.role.user", "You")
            : ChatStrings.string("chat.role.assistant", "Assistant")
    }

    private var accessibilityText: String {
        ChatAccessibility.messageLabel(
            role: roleLabel,
            text: resolved.visibleText,
            time: resolved.showTimestamp ? timeText : nil
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            messageText
            if resolved.showTimestamp {
                Text(verbatim: timeText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    @ViewBuilder
    private var messageText: some View {
        if resolved.isUser {
            Text(verbatim: resolved.visibleText)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        } else {
            HStack(alignment: .lastTextBaseline, spacing: 2) {
                Text(ChatMarkdown.attributed(resolved.visibleText))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                if resolved.isStreaming {
                    ChatStreamingCursor()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The blinking caret shown while an assistant reply streams (web pulsing cursor).
/// Static under Reduce Motion.
struct ChatStreamingCursor: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        RoundedRectangle(cornerRadius: 1, style: .continuous)
            .fill(Color.TS.chartSeriesPower.opacity(0.8))
            .frame(width: 3, height: 14)
            .opacity(dim ? 0.2 : 1)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                    dim = true
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Inline editor (web editing branch)

/// The inline edit field with cancel + save-and-resend actions (web `Textarea` +
/// `Button`s). Escape cancels (web `onKeyDown` Escape); the save button is the
/// platform-native submit affordance (the multi-line editor reserves Return for
/// newlines).
struct ChatEditView: View {
    @Bindable var model: ChatMessageModel

    private var editLabel: String {
        ChatStrings.string("chatbot.aria.editMessage", "Edit message")
    }

    private var cancelTitle: String {
        ChatStrings.string("chatbot.actions.cancel", "Cancel")
    }

    private var saveTitle: String {
        ChatStrings.string("chatbot.actions.saveAndResend", "Save & resend")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSTextArea(text: $model.draft, minHeight: 76)
                .accessibilityLabel(Text(verbatim: editLabel))
                .accessibilityIdentifier("chat.edit.field")
            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSButton(
                    variant: .ghost,
                    size: .small,
                    action: { model.cancelEdit() },
                    label: { ChatActionLabel.make("xmark", cancelTitle) }
                )
                .accessibilityLabel(Text(verbatim: cancelTitle))
                TSButton(
                    variant: .primary,
                    size: .small,
                    action: { model.commitEdit() },
                    label: { ChatActionLabel.make("checkmark", saveTitle) }
                )
                .disabled(!model.canSubmitEdit)
                .accessibilityLabel(Text(verbatim: saveTitle))
            }
        }
        .onKeyPress(.escape) {
            model.cancelEdit()
            return .handled
        }
    }
}

// MARK: - Action row (web hover actions)

/// The action row: copy on every message, regenerate on the last assistant reply,
/// edit on the last user message (web `CopyButton` + gated `Button`s).
struct ChatActionRow: View {
    let model: ChatMessageModel

    private var resolved: ChatMessageResolved {
        model.resolved
    }

    private var copyLabel: String {
        ChatStrings.string("chatbot.aria.copyMessage", "Copy message")
    }

    private var regenerateTitle: String {
        ChatStrings.string("chatbot.actions.regenerate", "Regenerate")
    }

    private var regenerateLabel: String {
        ChatStrings.string("chatbot.aria.regenerate", "Regenerate response")
    }

    private var editTitle: String {
        ChatStrings.string("chatbot.actions.edit", "Edit")
    }

    private var editLabel: String {
        ChatStrings.string("chatbot.aria.edit", "Edit and resend")
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TSCopyButton(value: resolved.message.content)
                .accessibilityLabel(Text(verbatim: copyLabel))
            if resolved.canRegenerate {
                TSButton(
                    variant: .ghost,
                    size: .small,
                    action: { model.regenerate() },
                    label: { ChatActionLabel.make("arrow.clockwise", regenerateTitle) }
                )
                .accessibilityLabel(Text(verbatim: regenerateLabel))
            }
            if resolved.canEdit {
                TSButton(
                    variant: .ghost,
                    size: .small,
                    action: { model.beginEdit() },
                    label: { ChatActionLabel.make("pencil", editTitle) }
                )
                .accessibilityLabel(Text(verbatim: editLabel))
            }
        }
    }
}

/// Shared icon + title label for the small ghost/primary action buttons.
enum ChatActionLabel {
    static func make(_ systemImage: String, _ title: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: title)
        }
    }
}
