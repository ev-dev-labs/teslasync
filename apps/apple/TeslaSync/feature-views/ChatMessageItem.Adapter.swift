//
//  ChatMessageItem.Adapter.swift
//  TeslaSync — P4 feature view · 0219 · ChatMessageItem (Apple)
//
//  The testable projection core for the chat message row — the SwiftUI parity of
//  features/system/components/chatbot/ChatMessageItem.tsx plus the web helpers it is
//  fed by: `formatTime` (lib/dateFormat.ts), the `streamedText ?? content` reveal,
//  the `submitEdit` trim/cancel semantics, and the `MarkdownRenderer` assistant
//  render. Everything here is pure + dependency-free (no store, no bundle, no
//  rendered view) so the role model, the timestamp formatting, the visible-text
//  selection, the inline-edit outcome, the markdown projection, and the VoiceOver
//  summary are all unit tested in isolation.
//

import Foundation

// MARK: - Role + message model (web `ChatMessage` / `UIChatMessage`)

/// The author of a chat row — the native mirror of the web `role: 'user' |
/// 'assistant'`. Drives the bubble alignment, accent, and avatar glyph.
public enum ChatRole: String, Sendable, Equatable {
    case user
    case assistant
}

/// One chat message — the native mirror of the web `UIChatMessage` (the wire-level
/// `ChatMessage` plus the UI-only `isStreaming` / `streamedText`). `createdAt` is a
/// parsed `Date?` (the shared data layer parses the wire `created_at` string), so no
/// further parsing happens at the view boundary.
public struct ChatMessageData: Identifiable, Sendable, Equatable {
    public let id: Int
    public let role: ChatRole
    public let content: String
    public let createdAt: Date?
    public let isStreaming: Bool
    public let streamedText: String?

    public init(
        id: Int,
        role: ChatRole,
        content: String,
        createdAt: Date? = nil,
        isStreaming: Bool = false,
        streamedText: String? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.isStreaming = isStreaming
        self.streamedText = streamedText
    }

    /// Web `message.role === 'user'`.
    public var isUser: Bool {
        role == .user
    }

    /// Web `message.streamedText ?? message.content` — the partial reveal during the
    /// typewriter animation, falling back to the full content.
    public var visibleText: String {
        ChatText.visibleText(content: content, streamedText: streamedText)
    }

    /// The empty assistant stand-in used while the bound message is absent (the
    /// loading phase) so the projection is never fed a nil message.
    public static let absent = ChatMessageData(id: 0, role: .assistant, content: "")
}

// MARK: - Text helpers (web visibleText + trim semantics)

/// Pure text helpers ported from the web component: the streamed-text reveal and the
/// `String.trim()`-based blank check the edit + empty branches rely on.
public enum ChatText {
    /// Web `streamedText ?? content`.
    public static func visibleText(content: String, streamedText: String?) -> String {
        streamedText ?? content
    }

    /// Whitespace/newline-only (or empty) — the guard behind the web empty render and
    /// the `submitEdit` trim check.
    public static func isBlank(_ value: String) -> Bool {
        value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// MARK: - Inline edit outcome (web `submitEdit`)

/// The result of resolving an inline edit — cancel (no-op) or submit the trimmed
/// text. The native mirror of the web `submitEdit` early-return vs. `onEditAndResend`.
public enum ChatEditOutcome: Sendable, Equatable {
    case cancel
    case submit(String)
}

/// Pure inline-edit resolution — the native port of the web `submitEdit`.
public enum ChatEdit {
    /// Trims the draft, cancels when it is empty or unchanged (vs. the original
    /// trimmed content), otherwise submits the trimmed text — verbatim web semantics.
    public static func outcome(draft: String, original: String) -> ChatEditOutcome {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let originalTrimmed = original.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == originalTrimmed {
            return .cancel
        }
        return .submit(trimmed)
    }
}

// MARK: - Timestamp formatting (web `formatTime`)

/// Pure timestamp formatting ported from `formatTime` (lib/dateFormat.ts) so the
/// missing-date sentinel and the locale hour/minute rendering match the source.
public enum ChatFormat {
    /// The em-dash sentinel the web renders for a missing/invalid date.
    public static let dash = "—"

    /// Native port of `formatTime`: `—` for a missing date, else a locale short time
    /// (hour + minute), matching the web
    /// `toLocaleTimeString({ hour: '2-digit', minute: '2-digit' })`.
    public static func time(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Assistant markdown (web `MarkdownRenderer`)

/// The assistant markdown projection — the native analogue of the web
/// `MarkdownRenderer` (react-markdown + remark-gfm).
public enum ChatMarkdown {
    /// Renders the assistant markdown source as an `AttributedString`. Inline syntax
    /// is interpreted with whitespace preserved (matching the web
    /// `whitespace-pre-wrap` fallback); a parse failure returns the raw text so a
    /// reply is never dropped. Raw HTML is never executed — Foundation renders it as
    /// text — mirroring the web's deliberate `rehype-raw`-off sanitization.
    public static func attributed(_ text: String) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: false,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        if let parsed = try? AttributedString(markdown: text, options: options) {
            return parsed
        }
        return AttributedString(text)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver row label from already-localised parts so the spoken content
/// is asserted without rendering the view.
public enum ChatAccessibility {
    /// "{role}: {text}" plus ", {time}" when a timestamp is shown.
    public static func messageLabel(role: String, text: String, time: String?) -> String {
        if let time, !time.isEmpty {
            return "\(role): \(text), \(time)"
        }
        return "\(role): \(text)"
    }
}
