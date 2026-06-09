//
//  CodeBlock.Adapter.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  The pure, Foundation-only projection core for the chatbot fenced-code block — the SwiftUI parity of
//  features/system/components/chatbot/CodeBlock.tsx. It turns a cached `CodeBlockSnapshot` into the
//  view-ready `CodeBlockProjection`: the displayed language tag (web `language?.trim() || 'text'`), the
//  rendered code body, the clipboard payload (web `text`), the line count (diagnostics), and the VoiceOver
//  label. A pure function of its input so the surface is a pure function of this value and the whole
//  pipeline is unit-tested in isolation (no bundle, no rendered view).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core so
/// it is reachable from the projection's unit tests and the SwiftUI view alike.
public enum CodeBlockSurface {
    public static let slug = "CodeBlock"
}

// MARK: - Projection (web render branch, view-ready)

/// The view-ready projection of one snippet — the language tag, the rendered code body, the clipboard
/// payload, the line count, and the combined VoiceOver label. A pure function of the snapshot, so the card
/// view is a pure function of this value.
public struct CodeBlockProjection: Sendable, Equatable {
    /// The header language tag (web `langLabel`); shown uppercased by the view.
    public let languageLabel: String
    /// The code body rendered verbatim in the scrollable `<pre>` (web `children ?? text`).
    public let code: String
    /// The clipboard payload the copy button writes (web CopyButton `text`).
    public let copyPayload: String
    /// The number of code lines (diagnostics / tests).
    public let lineCount: Int
    /// The card's VoiceOver label (e.g. "Code block, swift").
    public let accessibilityLabel: String

    public init(
        languageLabel: String,
        code: String,
        copyPayload: String,
        lineCount: Int,
        accessibilityLabel: String
    ) {
        self.languageLabel = languageLabel
        self.code = code
        self.copyPayload = copyPayload
        self.lineCount = lineCount
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Projector (cached snapshot → projection)

/// Pure projection from a cached `CodeBlockSnapshot` to the view-ready `CodeBlockProjection` — the native
/// port of the web component's body. Reproduces the `language?.trim() || 'text'` label rule and forwards
/// the raw `text` verbatim as both the rendered body and the clipboard payload (web `children ?? text` /
/// CopyButton `text`). Pinned by the adapter unit tests.
public enum CodeBlockProjector {
    public static func project(_ snapshot: CodeBlockSnapshot) -> CodeBlockProjection {
        let label = snapshot.resolvedLanguageLabel
        let code = snapshot.text
        let template = CodeBlockStrings.string("codeBlock.a11y.label", "Code block, %@")
        return CodeBlockProjection(
            languageLabel: label,
            code: code,
            copyPayload: code,
            lineCount: CodeBlockProjector.lineCount(of: code),
            accessibilityLabel: String(format: template, label)
        )
    }

    /// Counts code lines (1 for a non-empty single line, 0 for an empty body), keeping a trailing newline
    /// from inflating the count — used by diagnostics + the loading-skeleton row estimate.
    static func lineCount(of code: String) -> Int {
        guard !code.isEmpty else { return 0 }
        let trimmedTrailing = code.hasSuffix("\n") ? String(code.dropLast()) : code
        return trimmedTrailing.split(separator: "\n", omittingEmptySubsequences: false).count
    }
}
