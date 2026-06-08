//
//  MarkdownRenderer.Projection.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The projected, view-ready pieces for the chatbot markdown renderer: the diagnostics surface slug
//  (P1/S11 `view.opened`), the plain-text projection (the loading fallback + accessibility text), the
//  document statistics (diagnostics / tests), and the per-phase VoiceOver summary builder. Foundation-only
//  so it executes on a plain host and is pinned by tests.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core so
/// it is reachable from the projection's unit tests.
public enum MarkdownRendererSurface {
    public static let slug = "MarkdownRenderer"
}

// MARK: - Plain-text projection (loading fallback + accessibility)

/// Renders a parsed document (or its blocks) back to readable plain text — the spoken accessibility text
/// for the rendered surface, and the structural inverse the tests assert against. The live loading state
/// shows the RAW markdown verbatim (web `whitespace-pre-wrap`), so this is for the resolved document.
public enum MarkdownPlainText {
    public static func render(_ document: MarkdownDocument) -> String {
        render(document.blocks).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func render(_ blocks: [MarkdownBlock]) -> String {
        blocks.map(render(_:)).joined(separator: "\n")
    }

    private static func render(_ block: MarkdownBlock) -> String {
        switch block {
        case let .heading(_, inlines):
            MarkdownInlineText.flatten(inlines)
        case let .paragraph(inlines):
            MarkdownInlineText.flatten(inlines)
        case let .codeBlock(code):
            code.code
        case let .unorderedList(items):
            items.map { renderItem($0, bullet: "•") }.joined(separator: "\n")
        case let .orderedList(start, items):
            renderOrdered(items, start: start)
        case let .blockquote(blocks):
            render(blocks)
        case let .table(table):
            renderTable(table)
        case .thematicBreak:
            "—"
        }
    }

    private static func renderOrdered(_ items: [MarkdownListItem], start: Int) -> String {
        items.enumerated()
            .map { offset, item in renderItem(item, bullet: "\(start + offset).") }
            .joined(separator: "\n")
    }

    private static func renderItem(_ item: MarkdownListItem, bullet: String) -> String {
        var line = "\(bullet) \(MarkdownInlineText.flatten(item.inlines))"
        if let task = item.task {
            line = "\(bullet) [\(task == .checked ? "x" : " ")] \(MarkdownInlineText.flatten(item.inlines))"
        }
        guard !item.children.isEmpty else { return line }
        return line + "\n" + render(item.children)
    }

    private static func renderTable(_ table: MarkdownTable) -> String {
        let header = table.headers.map(MarkdownInlineText.flatten).joined(separator: " | ")
        let rows = table.rows.map { row in
            row.map(MarkdownInlineText.flatten).joined(separator: " | ")
        }
        return ([header] + rows).joined(separator: "\n")
    }
}

// MARK: - Document statistics (diagnostics / tests)

/// A structural count of a parsed document — the testable summary of "what did the parser produce" and the
/// diagnostics payload for the surface (e.g. how many code blocks / links a reply contains).
public struct MarkdownDocumentStats: Sendable, Equatable {
    public var headings = 0
    public var paragraphs = 0
    public var codeBlocks = 0
    public var lists = 0
    public var listItems = 0
    public var tables = 0
    public var blockquotes = 0
    public var thematicBreaks = 0
    public var links = 0

    public init() {}

    /// Walks the document (including nested list / quote content) accumulating element counts.
    public static func make(_ document: MarkdownDocument) -> MarkdownDocumentStats {
        var stats = MarkdownDocumentStats()
        stats.accumulate(document.blocks)
        return stats
    }

    private mutating func accumulate(_ blocks: [MarkdownBlock]) {
        for block in blocks {
            accumulate(block)
        }
    }

    private mutating func accumulate(_ block: MarkdownBlock) {
        switch block {
        case let .heading(_, inlines):
            headings += 1
            links += MarkdownDocumentStats.countLinks(inlines)
        case let .paragraph(inlines):
            paragraphs += 1
            links += MarkdownDocumentStats.countLinks(inlines)
        case .codeBlock:
            codeBlocks += 1
        case let .unorderedList(items):
            lists += 1
            accumulate(items)
        case let .orderedList(_, items):
            lists += 1
            accumulate(items)
        case let .blockquote(blocks):
            blockquotes += 1
            accumulate(blocks)
        case let .table(table):
            tables += 1
            links += table.allCells.reduce(0) { $0 + MarkdownDocumentStats.countLinks($1) }
        case .thematicBreak:
            thematicBreaks += 1
        }
    }

    private mutating func accumulate(_ items: [MarkdownListItem]) {
        for item in items {
            listItems += 1
            links += MarkdownDocumentStats.countLinks(item.inlines)
            accumulate(item.children)
        }
    }

    /// Counts the links within an inline tree (recursing through emphasis spans).
    static func countLinks(_ inlines: [MarkdownInline]) -> Int {
        inlines.reduce(0) { total, inline in
            switch inline {
            case .link:
                total + 1
            case let .strong(children), let .emphasis(children), let .strikethrough(children):
                total + countLinks(children)
            case .text, .code, .lineBreak:
                total
            }
        }
    }
}

private extension MarkdownTable {
    /// Every cell (header + body) as flat inline runs — for link counting.
    var allCells: [[MarkdownInline]] {
        headers + rows.flatMap(\.self)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver summary. Copy is injected (pre-localized) so the summaries are testable
/// without a bundle, exactly like the view's P1/S10 facade.
public enum MarkdownRendererAccessibility {
    /// The spoken status for the current phase. `ready` reads the document label so VoiceOver announces a
    /// formatted message before diving into its elements.
    public static func summary(for phase: MarkdownRenderPhase, copy: MarkdownRendererCopy) -> String {
        switch phase {
        case .loading:
            copy.loadingLabel
        case .ready:
            copy.documentLabel
        case .empty:
            copy.emptyLabel
        case .error:
            copy.errorLabel
        }
    }
}
