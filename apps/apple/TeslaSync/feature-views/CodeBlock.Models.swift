//
//  CodeBlock.Models.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  The Foundation-only value types for the chatbot fenced-code block — the SwiftUI parity of
//  features/system/components/chatbot/CodeBlock.tsx, the presentational wrapper react-markdown hands its
//  fenced code: a bordered card with a header (the uppercased language tag + a copy-to-clipboard button)
//  over a horizontally scrollable monospaced body. No syntax highlighting (web parity — plain mono keeps
//  the bundle lean and is good enough for the short snippets the assistant emits).
//
//  These types model the snippet (the web `language` + `text` props), the content load status, the render
//  phase, and the live-state freshness envelope — all free of SwiftUI so the projection compiles and
//  unit-tests on a plain host (no bundle, no rendered view). The web leaf is purely presentational and is
//  fed its props by `MarkdownRenderer`; the native surface owns the full lifecycle through these types so
//  every prompt-required state (loading / empty / error / stale / offline / content) has a real branch.
//

import Foundation

// MARK: - Snapshot (web `language` + `text` props)

/// One fenced-code snippet — the exact subset of the web `CodeBlockProps` the surface renders: the fence
/// info-string `language` (e.g. `ts`, `go`, `bash`, `nil`/blank when the fence had none) and the raw
/// `text` (the body AND the clipboard payload). The web `children` prop is the already-escaped React
/// re-render of that same `text`; with no syntax highlighting the native surface renders `text` verbatim,
/// so a single field captures both.
public struct CodeBlockSnapshot: Sendable, Equatable {
    /// The fence info-string (web `language`), `nil`/blank when the fence carried none.
    public var language: String?
    /// The raw code body, rendered verbatim and used as the clipboard payload (web `text`).
    public var text: String

    public init(language: String? = nil, text: String) {
        self.language = language
        self.text = text
    }

    /// Whether the snippet carries renderable code. A blank / whitespace-only body drives the surface's
    /// empty state rather than a blank `<pre>` box (the prompt's "never a blank box" requirement).
    public var hasContent: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// The displayed language tag — the trimmed language, or `text` when blank. Direct port of the web
    /// `langLabel = language?.trim() || 'text'`.
    public var resolvedLanguageLabel: String {
        let trimmed = language?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? CodeBlockConfig.defaultLanguageLabel : trimmed
    }
}

// MARK: - Content load status + render phase

/// The bound source's status for the snippet. The web leaf always has its complete `text` prop; the native
/// seam additionally models the host still resolving the snippet (`idle`) and a load failure (`failed`) so
/// every prompt-required state has a real branch.
public enum CodeBlockContentStatus: Sendable, Equatable {
    /// No snippet yet (initial fetch) — the surface shows a card-shaped skeleton.
    case idle
    /// The snippet is ready to render (web's always-present `text` prop).
    case ready(CodeBlockSnapshot)
    /// Loading the snippet failed.
    case failed(String)
}

/// What the surface should render. `loading` is the initial fetch, `content` is the rendered card, `empty`
/// is a resolved-but-blank snippet, `error` is a load failure (web `QueryError` equivalent).
public enum CodeBlockRenderPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the connectivity banner. The rendered card
/// is shown from cache while `stale`/`offline`; the chip simply communicates connectivity.
public enum CodeBlockConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `CodeBlockSource`: the content load status, the live-state
/// connection, and the last-update timestamp.
public struct CodeBlockUpdate: Sendable, Equatable {
    public var content: CodeBlockContentStatus
    public var connection: CodeBlockConnection
    public var updatedAt: Date?

    public init(
        content: CodeBlockContentStatus = .idle,
        connection: CodeBlockConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.content = content
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - Config (web literals)

/// The constants the web source bakes in.
public enum CodeBlockConfig {
    /// The default fence label the web shows when no language is set (`language?.trim() || 'text'`). A
    /// language tag, not a UI string — kept as a plain constant exactly like `MarkdownCodeBlock`.
    public static let defaultLanguageLabel = "text"
}
