//
//  MarkdownRenderer.Views.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The inline → SwiftUI renderers for the chatbot markdown renderer: the `AttributedString` builder that
//  maps inline spans (strong / em / del / code / link) to native text runs, the block dispatcher, the leaf
//  block views (heading, paragraph, thematic break), and the live-state freshness chip + connectivity
//  banner. All chrome is token-driven (P1/S9); all copy resolves through the P1/S10 facade. Multi-line
//  block views (lists / blockquotes / tables) live in MarkdownRenderer.BlockViews.swift; fenced code lives
//  in MarkdownRenderer.CodeBlock.swift.
//

import SwiftUI

private typealias SwiftUIAttrs = AttributeScopes.SwiftUIAttributes
private typealias FoundationAttrs = AttributeScopes.FoundationAttributes

// MARK: - Inline → AttributedString

/// The accumulated inline style applied to a leaf text run while walking the inline tree.
private struct MarkdownInlineStyle {
    var bold = false
    var italic = false
    var strikethrough = false
    var code = false
    var link: URL?
}

/// Builds a SwiftUI `AttributedString` from an inline span tree. Emphasis nests by accumulating style;
/// links resolve to a tappable `.link` run ONLY for safe schemes (the native parity of the web source's
/// `rel="noopener noreferrer"` + safe-by-default posture) and otherwise render as inert accent text.
enum MarkdownAttributed {
    static func build(_ inlines: [MarkdownInline], baseFont: Font, baseColor: Color) -> AttributedString {
        var result = AttributedString()
        append(inlines, into: &result, style: MarkdownInlineStyle(), baseFont: baseFont, baseColor: baseColor)
        return result
    }

    private static func append(
        _ inlines: [MarkdownInline],
        into result: inout AttributedString,
        style: MarkdownInlineStyle,
        baseFont: Font,
        baseColor: Color
    ) {
        for inline in inlines {
            switch inline {
            case let .text(value):
                result.append(run(value, style: style, baseFont: baseFont, baseColor: baseColor))
            case let .code(value):
                var next = style
                next.code = true
                result.append(run(value, style: next, baseFont: baseFont, baseColor: baseColor))
            case let .strong(children):
                var next = style
                next.bold = true
                append(children, into: &result, style: next, baseFont: baseFont, baseColor: baseColor)
            case let .emphasis(children):
                var next = style
                next.italic = true
                append(children, into: &result, style: next, baseFont: baseFont, baseColor: baseColor)
            case let .strikethrough(children):
                var next = style
                next.strikethrough = true
                append(children, into: &result, style: next, baseFont: baseFont, baseColor: baseColor)
            case let .link(link):
                var next = style
                if link.isSafeToOpen { next.link = URL(string: link.destination) }
                append(link.children, into: &result, style: next, baseFont: baseFont, baseColor: baseColor)
            case .lineBreak:
                result.append(AttributedString("\n"))
            }
        }
    }

    private static func run(
        _ text: String,
        style: MarkdownInlineStyle,
        baseFont: Font,
        baseColor: Color
    ) -> AttributedString {
        var run = AttributedString(text)
        var container = AttributeContainer()
        var font = style.code ? baseFont.monospaced() : baseFont
        if style.bold { font = font.bold() }
        if style.italic { font = font.italic() }
        container[SwiftUIAttrs.FontAttribute.self] = font
        container[SwiftUIAttrs.ForegroundColorAttribute.self] = style.link == nil ? baseColor : Color.TS.accent
        if style.code {
            container[SwiftUIAttrs.BackgroundColorAttribute.self] = Color.TS.surfaceGlass
        }
        if style.strikethrough {
            container[SwiftUIAttrs.StrikethroughStyleAttribute.self] = Text.LineStyle.single
        }
        if let link = style.link {
            container[FoundationAttrs.LinkAttribute.self] = link
            container[SwiftUIAttrs.UnderlineStyleAttribute.self] = Text.LineStyle.single
        }
        run.mergeAttributes(container)
        return run
    }
}

/// Convenience that wraps a built `AttributedString` into a `Text` for a sequence of inline spans.
enum MarkdownInlineView {
    static func text(_ inlines: [MarkdownInline], font: Font, color: Color = Color.TS.textPrimary) -> Text {
        Text(MarkdownAttributed.build(inlines, baseFont: font, baseColor: color))
    }
}

// MARK: - Document + block dispatch

/// Renders a parsed document as a vertical stack of block views — the web `<div className="prose-chat
/// space-y-1">` body.
struct MarkdownDocumentView: View {
    let document: MarkdownDocument
    let onCopy: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(Array(document.blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block, onCopy: onCopy)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// Dispatches one block to its renderer.
struct MarkdownBlockView: View {
    let block: MarkdownBlock
    let onCopy: (String) -> Void

    var body: some View {
        switch block {
        case let .heading(level, inlines):
            MarkdownHeadingView(level: level, inlines: inlines)
        case let .paragraph(inlines):
            MarkdownInlineView.text(inlines, font: Font.TS.body)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        case let .codeBlock(code):
            MarkdownCodeBlockView(block: code, onCopy: onCopy)
        case let .unorderedList(items):
            MarkdownListView(items: items, ordered: false, start: 1, onCopy: onCopy)
        case let .orderedList(start, items):
            MarkdownListView(items: items, ordered: true, start: start, onCopy: onCopy)
        case let .blockquote(blocks):
            MarkdownBlockquoteView(blocks: blocks, onCopy: onCopy)
        case let .table(table):
            MarkdownTableView(table: table)
        case .thematicBreak:
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
                .padding(.vertical, TSSpacing.xs)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Heading + leaf views

/// An ATX heading rendered at the chat-scale type ramp (web h1 = base, h2/h3 = small), carrying the
/// `.isHeader` trait for VoiceOver rotor navigation.
struct MarkdownHeadingView: View {
    let level: Int
    let inlines: [MarkdownInline]

    var body: some View {
        MarkdownInlineView.text(inlines, font: Self.font(for: level))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, level <= 2 ? TSSpacing.xs : 0)
            .accessibilityAddTraits(.isHeader)
    }

    static func font(for level: Int) -> Font {
        switch level {
        case 1:
            Font.TS.section
        case 2:
            Font.TS.panel
        default:
            Font.TS.body.weight(.semibold)
        }
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013).
struct MarkdownFreshnessChip: View {
    let connection: MarkdownConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            MarkdownRendererStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(MarkdownRendererStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: MarkdownConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "markdownRenderer.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "markdownRenderer.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "markdownRenderer.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the rendered content when the bound source is not live, so the
/// surface is clearly labelled while the cached message is shown.
struct MarkdownConnectivityBanner: View {
    let connection: MarkdownConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "markdownRenderer.offlineBanner" : "markdownRenderer.staleBanner"
        let fallback = offline
            ? "Offline — showing the last received message"
            : "Reconnecting — showing the cached message"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            MarkdownRendererStrings.text(key, fallback).font(Font.TS.caption)
            Spacer(minLength: 0)
            MarkdownFreshnessChip(connection: connection)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
