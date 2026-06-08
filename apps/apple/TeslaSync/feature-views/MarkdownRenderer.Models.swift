//
//  MarkdownRenderer.Models.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The Foundation-only value types for the chatbot markdown renderer — the SwiftUI parity of
//  features/system/components/chatbot/MarkdownRenderer.tsx (which renders an assistant chat message as
//  sanitized markdown via react-markdown + remark-gfm, delegating fenced code to CodeBlock.tsx). The web
//  source is safe-by-default: it never renders raw HTML, opens links in a new tab with
//  rel="noopener noreferrer", and falls back to whitespace-preserving raw text while its lazy chunk loads.
//
//  These types model the parsed markdown document (blocks + inline spans), the content load status (web
//  Suspense boundary), the render phase, and the live-state freshness envelope — all free of SwiftUI so
//  the parser + projection compile and unit-test on a plain host (no bundle, no rendered view).
//

import Foundation

// MARK: - Inline spans (react-markdown inline renderers)

/// One inline span produced by `MarkdownInlineParser`. Mirrors the inline renderers the web source wires
/// into react-markdown: `strong`/`em`/`del` emphasis, inline `code`, and the secured `a` link, plus the
/// gfm autolink literal. Raw HTML (e.g. `<script>`) is NEVER a node here — the parser emits it as literal
/// `.text`, reproducing react-markdown's safe-by-default escaping (no `rehype-raw`).
public indirect enum MarkdownInline: Sendable, Equatable {
    /// A literal text run (already HTML-unescaped/sanitized; rendered verbatim).
    case text(String)
    /// Bold (`**…**` / `__…__`) — web `strong`.
    case strong([MarkdownInline])
    /// Italic (`*…*` / `_…_`) — web `em`.
    case emphasis([MarkdownInline])
    /// Strikethrough (`~~…~~`, gfm) — web `del`.
    case strikethrough([MarkdownInline])
    /// Inline code (`` `…` ``) — web inline `code` (no language). Content is literal (never re-parsed).
    case code(String)
    /// A hyperlink (`[text](href)` or an autolink) — web `a` with `target="_blank"
    /// rel="noopener noreferrer"`. `destination` is the raw href; the renderer opens only safe schemes.
    case link(MarkdownLink)
    /// A hard line break (two trailing spaces or a backslash before a newline).
    case lineBreak
}

/// A resolved hyperlink span. `children` is the link's inline label; `destination` is the raw href exactly
/// as authored (never re-encoded), matching the web source which forwards `href` verbatim onto the `a`.
public struct MarkdownLink: Sendable, Equatable {
    public var children: [MarkdownInline]
    public var destination: String
    public var title: String?

    public init(children: [MarkdownInline], destination: String, title: String? = nil) {
        self.children = children
        self.destination = destination
        self.title = title
    }

    /// The schemes the renderer will open as a tappable link. Everything else renders as inert styled
    /// text so the chatbot surface can't be used as a redirect / `javascript:` execution vector — the
    /// native analogue of the web source's `rel="noopener noreferrer"` + safe-by-default posture.
    public static let safeSchemes: Set<String> = ["http", "https", "mailto", "tel"]

    /// The plain-text label (the link's inline children flattened) — used for accessibility + the
    /// raw-text projection.
    public var plainText: String {
        MarkdownInlineText.flatten(children)
    }

    /// Whether `destination` carries one of the `safeSchemes` (case-insensitive). Relative links
    /// (`/foo`, `#anchor`) and bare autolinked hosts are treated as unsafe-to-open and render inert.
    public var isSafeToOpen: Bool {
        guard let scheme = Self.scheme(of: destination) else { return false }
        return Self.safeSchemes.contains(scheme)
    }

    /// Extracts the lowercased URI scheme (the text before the first `:`) when the destination is a
    /// well-formed absolute URI, else `nil` (relative path, fragment, or malformed).
    public static func scheme(of destination: String) -> String? {
        guard let colon = destination.firstIndex(of: ":") else { return nil }
        let candidate = destination[destination.startIndex ..< colon]
        guard !candidate.isEmpty else { return nil }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-.")
        for scalar in candidate.unicodeScalars where !allowed.contains(scalar) {
            return nil
        }
        let first = candidate.unicodeScalars.first!
        guard CharacterSet.letters.contains(first) else { return nil }
        return candidate.lowercased()
    }
}

// MARK: - Block elements (react-markdown block renderers)

/// One block-level element produced by `MarkdownParser`. Mirrors the block renderers the web source maps:
/// `h1…h3` headings, paragraphs, fenced `code` blocks (delegated to CodeBlock), `ul`/`ol` lists (with gfm
/// task items), blockquotes, gfm `table`, and the thematic break.
public indirect enum MarkdownBlock: Sendable, Equatable {
    /// An ATX heading. `level` is 1…6 (web styles h1/h2/h3; deeper levels reuse the h3 treatment).
    case heading(level: Int, inlines: [MarkdownInline])
    /// A paragraph of inline content.
    case paragraph([MarkdownInline])
    /// A fenced code block — web `CodeBlock` (language tag + copy-to-clipboard).
    case codeBlock(MarkdownCodeBlock)
    /// A bullet list — web `ul` (`list-disc`).
    case unorderedList([MarkdownListItem])
    /// A numbered list — web `ol` (`list-decimal`). `start` is the first ordinal (gfm respects it).
    case orderedList(start: Int, items: [MarkdownListItem])
    /// A blockquote (`>`); holds nested blocks so quoted lists / code survive.
    case blockquote([MarkdownBlock])
    /// A gfm table (header row + alignment + body rows).
    case table(MarkdownTable)
    /// A thematic break (`---` / `***` / `___`) — web `hr`.
    case thematicBreak
}

/// A fenced code block. `language` is the fence info-string (e.g. `ts`, `go`, `bash`), `nil`/blank when
/// the fence had none. `code` is the raw, un-parsed body (sanitization: never inline-parsed nor HTML
/// interpreted). Parity with web CodeBlock, whose `langLabel = language?.trim() || 'text'`.
public struct MarkdownCodeBlock: Sendable, Equatable {
    public var language: String?
    public var code: String

    public init(language: String?, code: String) {
        self.language = language
        self.code = code
    }

    /// The default info-string the web CodeBlock shows when no language is set.
    public static let defaultLanguageLabel = "text"

    /// The displayed language tag — the trimmed language, or `text` when blank (web parity:
    /// `language?.trim() || 'text'`).
    public var languageLabel: String {
        let trimmed = language?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? Self.defaultLanguageLabel : trimmed
    }
}

/// A gfm checkbox state on a list item (`- [ ]` / `- [x]`). `nil` on the item means a plain bullet.
public enum MarkdownTask: Sendable, Equatable {
    case unchecked
    case checked
}

/// One list item. `inlines` is the item's leading line; `children` are nested blocks (sub-lists, extra
/// paragraphs) so nesting round-trips. `task` carries the gfm checkbox when present.
public struct MarkdownListItem: Sendable, Equatable {
    public var inlines: [MarkdownInline]
    public var task: MarkdownTask?
    public var children: [MarkdownBlock]

    public init(inlines: [MarkdownInline], task: MarkdownTask? = nil, children: [MarkdownBlock] = []) {
        self.inlines = inlines
        self.task = task
        self.children = children
    }
}

/// A gfm column alignment, parsed from the table delimiter row (`:--`, `:--:`, `--:`).
public enum MarkdownColumnAlignment: Sendable, Equatable {
    case none
    case leading
    case center
    case trailing
}

/// A gfm table: the header cells, the per-column alignment, and the body rows (each a list of cells, each
/// cell a list of inline spans). Ragged rows are tolerated — the renderer pads to the header width.
public struct MarkdownTable: Sendable, Equatable {
    public var headers: [[MarkdownInline]]
    public var alignments: [MarkdownColumnAlignment]
    public var rows: [[[MarkdownInline]]]

    public init(
        headers: [[MarkdownInline]],
        alignments: [MarkdownColumnAlignment],
        rows: [[[MarkdownInline]]]
    ) {
        self.headers = headers
        self.alignments = alignments
        self.rows = rows
    }

    /// The number of columns (the header width), used to pad ragged body rows.
    public var columnCount: Int {
        headers.count
    }
}

// MARK: - Parsed document

/// The parsed markdown document — the projection a `MarkdownParser.parse` produces from a raw source
/// string. Holds the ordered block list; `isEmpty` drives the surface's empty state.
public struct MarkdownDocument: Sendable, Equatable {
    public var blocks: [MarkdownBlock]

    public init(blocks: [MarkdownBlock] = []) {
        self.blocks = blocks
    }

    /// An empty document (the source was blank / whitespace-only) → the surface shows its empty state.
    public static let empty = MarkdownDocument()

    /// Whether the document carries no renderable blocks.
    public var isEmpty: Bool {
        blocks.isEmpty
    }

    /// The number of top-level blocks (diagnostics / tests).
    public var blockCount: Int {
        blocks.count
    }
}

// MARK: - Content load status (web Suspense boundary) + render phase

/// The bound source's status for the assistant message content. The web source always has its `children`
/// string and only suspends while the react-markdown chunk loads; the native seam additionally models the
/// host still fetching the message (`idle`) and a delivery failure (`failed`) so every prompt-required
/// state has a real branch.
public enum MarkdownContentStatus: Sendable, Equatable {
    /// No content yet (initial fetch) — the surface shows a minimal loading shell.
    case idle
    /// The raw markdown is available but the renderer is still warming up — the web Suspense fallback
    /// (`<p className="whitespace-pre-wrap">{children}</p>`); the surface shows the raw text meanwhile.
    case preparing(String)
    /// The raw markdown is ready to render.
    case ready(String)
    /// Loading the message content failed.
    case failed(String)
}

/// What the surface should render. `loading` covers `idle`/`preparing` (web Suspense fallback), `ready`
/// renders the parsed document, `empty` is a resolved-but-blank message, `error` is a delivery failure.
public enum MarkdownRenderPhase: Sendable, Equatable {
    case loading
    case ready
    case empty
    case error(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the connectivity banner. Rendered content
/// is shown from cache while `stale`/`offline`; the chip simply communicates connectivity.
public enum MarkdownConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `MarkdownRendererSource`: the content load status (web Suspense
/// boundary), the live-state connection, and the last-update timestamp.
public struct MarkdownRendererUpdate: Sendable, Equatable {
    public var content: MarkdownContentStatus
    public var connection: MarkdownConnection
    public var updatedAt: Date?

    public init(
        content: MarkdownContentStatus = .idle,
        connection: MarkdownConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.content = content
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - Injected, pre-localized copy (P1/S10) for the Foundation-only projection

/// The pre-localized strings the projection's accessibility summaries need. Injected so the summary stays
/// Foundation-only and host-testable; the view resolves the real catalog copy via the P1/S10 facade. The
/// web source is anonymous (it renders only the prose), so every value here backs native chrome.
public struct MarkdownRendererCopy: Sendable, Equatable {
    public var documentLabel: String
    public var loadingLabel: String
    public var emptyLabel: String
    public var errorLabel: String

    public init(
        documentLabel: String = "Formatted message",
        loadingLabel: String = "Loading message",
        emptyLabel: String = "No message content",
        errorLabel: String = "Couldn't load the message"
    ) {
        self.documentLabel = documentLabel
        self.loadingLabel = loadingLabel
        self.emptyLabel = emptyLabel
        self.errorLabel = errorLabel
    }

    /// English fallbacks — used by previews + tests.
    public static let fallback = MarkdownRendererCopy()
}

// MARK: - Config (web literals)

/// The constants the web source bakes in: the default code-fence label and the safe-to-open link schemes.
public enum MarkdownRendererConfig {
    /// Web CodeBlock default language label (`language?.trim() || 'text'`).
    public static let defaultCodeLanguage = MarkdownCodeBlock.defaultLanguageLabel
    /// The schemes a link opens (web opens any `href` in a new tab; native restricts to safe schemes).
    public static let safeLinkSchemes = MarkdownLink.safeSchemes
}
