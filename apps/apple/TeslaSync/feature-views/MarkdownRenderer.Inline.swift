//
//  MarkdownRenderer.Inline.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The inline tokenizer for the chatbot markdown renderer — the parser core for the inline renderers the
//  web source (features/system/components/chatbot/MarkdownRenderer.tsx) wires into react-markdown +
//  remark-gfm: `strong`/`em`/`del`, inline `code`, secured `a` links, and gfm autolink literals. It is
//  safe-by-default like the web source: a raw `<` that is not a valid autolink is emitted as LITERAL
//  text, so an assistant reply containing `<script>alert(1)</script>` renders as escaped text and never
//  as markup. Foundation-only so it is unit-tested without a bundle or a rendered view.
//

import Foundation

// MARK: - Inline flattening (plain text projection)

/// Flattens an inline tree to its plain text — the loading fallback (web `whitespace-pre-wrap`) + the
/// accessibility label both use this, so the spoken/copy text never leaks markdown punctuation.
public enum MarkdownInlineText {
    public static func flatten(_ inlines: [MarkdownInline]) -> String {
        inlines.map(flatten(_:)).joined()
    }

    private static func flatten(_ inline: MarkdownInline) -> String {
        switch inline {
        case let .text(value):
            value
        case let .code(value):
            value
        case let .strong(children), let .emphasis(children), let .strikethrough(children):
            flatten(children)
        case let .link(link):
            flatten(link.children)
        case .lineBreak:
            "\n"
        }
    }
}

// MARK: - Inline parser entry

/// Parses a single line/region of markdown text into inline spans. The block parser
/// (`MarkdownParser`) calls this for every heading / paragraph / list-item / table-cell / blockquote
/// line; fenced code blocks are NEVER passed here (their bodies stay literal).
public enum MarkdownInlineParser {
    public static func parse(_ text: String) -> [MarkdownInline] {
        let scanner = InlineScanner(text)
        return scanner.parse(from: 0, to: scanner.count, depth: 0)
    }
}

// MARK: - Scanner

/// A small accumulator the inline scanner writes into — pending text (gfm-autolinked on flush) plus the
/// resolved node list. A single value passed `inout` so the per-character helpers never alias the buffer
/// and the node list at once (which would trip Swift's runtime exclusivity enforcement).
private struct InlineSink {
    private(set) var nodes: [MarkdownInline] = []
    private var buffer = ""

    /// Whether the pending text ends in a markdown hard break (two trailing spaces).
    var endsWithHardBreak: Bool {
        buffer.hasSuffix("  ")
    }

    mutating func append(character: Character) {
        buffer.append(character)
    }

    /// Appends a resolved node, flushing any pending text first so document order is preserved.
    mutating func append(node: MarkdownInline) {
        flush()
        nodes.append(node)
    }

    /// Adds a single soft-break space unless the buffer is empty or already ends in a space.
    mutating func appendSoftBreakSpace() {
        guard !buffer.isEmpty, !buffer.hasSuffix(" ") else { return }
        buffer.append(" ")
    }

    /// Flushes the pending text (gfm-autolinking any bare URLs) into the node list.
    mutating func flush() {
        guard !buffer.isEmpty else { return }
        nodes.append(contentsOf: MarkdownAutolinker.scan(buffer))
        buffer = ""
    }

    /// Trims the trailing hard-break spaces then flushes.
    mutating func flushTrimmingTrailingSpaces() {
        while buffer.hasSuffix(" ") {
            buffer.removeLast()
        }
        flush()
    }
}

/// A bounds-based recursive-descent scanner over the source characters. Each `scan*` helper returns the
/// produced node plus the index to resume at, or `nil` to fall back to literal text — keeping the main
/// loop small and every branch independently testable.
private struct InlineScanner {
    let chars: [Character]
    let maxDepth = 8

    init(_ text: String) {
        chars = Array(text)
    }

    var count: Int {
        chars.count
    }

    /// Parses the half-open `[start, end)` range into inline spans, threading the emphasis-nesting depth.
    func parse(from start: Int, to end: Int, depth: Int) -> [MarkdownInline] {
        var sink = InlineSink()
        var index = start
        while index < end {
            let char = chars[index]
            if char == "\\", index + 1 < end {
                index = consumeEscape(at: index, sink: &sink)
                continue
            }
            if char == "\n" {
                consumeNewline(sink: &sink)
                index += 1
                continue
            }
            if depth < maxDepth, let hit = scan(at: index, to: end, depth: depth) {
                sink.append(node: hit.node)
                index = hit.next
                continue
            }
            sink.append(character: char)
            index += 1
        }
        sink.flush()
        return sink.nodes
    }

    /// Dispatches the four inline constructs by their lead character; `nil` means "treat as literal".
    private func scan(at index: Int, to end: Int, depth: Int) -> (node: MarkdownInline, next: Int)? {
        switch chars[index] {
        case "`":
            scanCodeSpan(at: index, to: end)
        case "<":
            scanAutolink(at: index, to: end)
        case "[":
            scanLink(at: index, to: end, depth: depth)
        case "*", "_", "~":
            scanEmphasis(at: index, to: end, depth: depth)
        default:
            nil
        }
    }

    // MARK: Escapes + breaks

    /// Handles a backslash escape: `\<punct>` emits the literal punctuation; `\<newline>` is a hard break.
    private func consumeEscape(at index: Int, sink: inout InlineSink) -> Int {
        let next = chars[index + 1]
        if next == "\n" {
            sink.append(node: .lineBreak)
            return index + 2
        }
        if Self.isEscapable(next) {
            sink.append(character: next)
            return index + 2
        }
        sink.append(character: "\\")
        return index + 1
    }

    /// Collapses a soft line break to a space, or emits a hard break when the line ended in two+ spaces.
    private func consumeNewline(sink: inout InlineSink) {
        if sink.endsWithHardBreak {
            sink.flushTrimmingTrailingSpaces()
            sink.append(node: .lineBreak)
        } else {
            sink.appendSoftBreakSpace()
        }
    }

    // MARK: Code spans

    private func scanCodeSpan(at start: Int, to end: Int) -> (node: MarkdownInline, next: Int)? {
        guard let resume = endOfCodeSpan(from: start, to: end) else { return nil }
        let openLength = runLength(of: "`", from: start, to: end)
        let contentStart = start + openLength
        let contentEnd = resume - openLength
        guard contentStart <= contentEnd else { return nil }
        var content = String(chars[contentStart ..< contentEnd])
        let hasPadding = content.hasPrefix(" ") && content.hasSuffix(" ")
        let hasContent = content.contains(where: { !$0.isWhitespace })
        if content.count >= 2, hasPadding, hasContent {
            content = String(content.dropFirst().dropLast())
        }
        return (.code(content), resume)
    }

    /// Returns the index just past the closing backtick run that matches the opening run length, or `nil`.
    private func endOfCodeSpan(from start: Int, to end: Int) -> Int? {
        let openLength = runLength(of: "`", from: start, to: end)
        var index = start + openLength
        while index < end {
            guard chars[index] == "`" else { index += 1; continue }
            let length = runLength(of: "`", from: index, to: end)
            if length == openLength { return index + length }
            index += length
        }
        return nil
    }

    // MARK: Autolinks (`<scheme:…>` / `<email>`)

    private func scanAutolink(at start: Int, to end: Int) -> (node: MarkdownInline, next: Int)? {
        guard let close = firstIndex(of: ">", from: start + 1, to: end) else { return nil }
        let content = String(chars[(start + 1) ..< close])
        guard !content.isEmpty, !content.contains(where: { $0.isWhitespace || $0 == "<" }) else { return nil }
        if MarkdownLink.scheme(of: content) != nil {
            return (.link(MarkdownLink(children: [.text(content)], destination: content)), close + 1)
        }
        if Self.isEmail(content) {
            return (.link(MarkdownLink(children: [.text(content)], destination: "mailto:" + content)), close + 1)
        }
        return nil
    }

    // MARK: Links (`[label](dest "title")`)

    private func scanLink(at start: Int, to end: Int, depth: Int) -> (node: MarkdownInline, next: Int)? {
        guard let labelClose = matching("[", "]", from: start, to: end) else { return nil }
        let parenOpen = labelClose + 1
        guard parenOpen < end, chars[parenOpen] == "(" else { return nil }
        guard let parenClose = matching("(", ")", from: parenOpen, to: end) else { return nil }
        let label = parse(from: start + 1, to: labelClose, depth: depth + 1)
        guard !label.isEmpty else { return nil }
        let raw = String(chars[(parenOpen + 1) ..< parenClose])
        let target = Self.parseDestination(raw)
        guard !target.destination.isEmpty else { return nil }
        let link = MarkdownLink(children: label, destination: target.destination, title: target.title)
        return (.link(link), parenClose + 1)
    }

    // MARK: Emphasis / strong / strikethrough

    private func scanEmphasis(at start: Int, to end: Int, depth: Int) -> (node: MarkdownInline, next: Int)? {
        let marker = chars[start]
        guard let length = emphasisLength(marker: marker, at: start, to: end) else { return nil }
        if marker == "_", isIntraword(before: start) { return nil }
        let contentStart = start + length
        guard contentStart < end, !chars[contentStart].isWhitespace else { return nil }
        guard let closeStart = closingDelimiter(marker: marker, length: length, from: contentStart, to: end)
        else { return nil }
        if marker == "_", isIntraword(after: closeStart + length, to: end) { return nil }
        let inner = parse(from: contentStart, to: closeStart, depth: depth + 1)
        guard !inner.isEmpty else { return nil }
        return (emphasisNode(marker: marker, length: length, inner: inner), closeStart + length)
    }

    /// The delimiter run length: `~~` strikethrough must be exactly two; `*`/`_` are two (strong) when
    /// doubled, else one (emphasis).
    private func emphasisLength(marker: Character, at start: Int, to end: Int) -> Int? {
        if marker == "~" {
            return (start + 1 < end && chars[start + 1] == "~") ? 2 : nil
        }
        return (start + 1 < end && chars[start + 1] == marker) ? 2 : 1
    }

    private func emphasisNode(marker: Character, length: Int, inner: [MarkdownInline]) -> MarkdownInline {
        if marker == "~" { return .strikethrough(inner) }
        return length == 2 ? .strong(inner) : .emphasis(inner)
    }

    /// Finds the matching closing delimiter run, skipping escapes + code spans, requiring the closer to
    /// not be preceded by whitespace (right-flanking).
    private func closingDelimiter(marker: Character, length: Int, from: Int, to end: Int) -> Int? {
        var index = from
        while index < end {
            let char = chars[index]
            if char == "\\" { index += 2; continue }
            if char == "`" {
                index = endOfCodeSpan(from: index, to: end) ?? (index + 1)
                continue
            }
            if char == marker {
                let length2 = runLength(of: marker, from: index, to: end)
                if length2 >= length, index > from, !chars[index - 1].isWhitespace {
                    return index
                }
                index += length2
                continue
            }
            index += 1
        }
        return nil
    }

    private func isIntraword(before start: Int) -> Bool {
        guard start > 0 else { return false }
        let prev = chars[start - 1]
        return prev.isLetter || prev.isNumber
    }

    private func isIntraword(after index: Int, to end: Int) -> Bool {
        guard index < end else { return false }
        let next = chars[index]
        return next.isLetter || next.isNumber
    }

    // MARK: Low-level scanning helpers

    private func runLength(of char: Character, from start: Int, to end: Int) -> Int {
        var index = start
        while index < end, chars[index] == char {
            index += 1
        }
        return index - start
    }

    private func firstIndex(of char: Character, from start: Int, to end: Int) -> Int? {
        var index = start
        while index < end {
            if chars[index] == char { return index }
            index += 1
        }
        return nil
    }

    /// Finds the index of the close character matching the open at `start`, honoring nesting + escapes +
    /// code spans (so `[a [b] c](x)` and `(a(b)c)` balance correctly).
    private func matching(_ open: Character, _ close: Character, from start: Int, to end: Int) -> Int? {
        var depth = 0
        var index = start
        while index < end {
            let char = chars[index]
            if char == "\\" { index += 2; continue }
            if char == "`" {
                index = endOfCodeSpan(from: index, to: end) ?? (index + 1)
                continue
            }
            if char == open {
                depth += 1
            } else if char == close {
                depth -= 1
                if depth == 0 {
                    return index
                }
            }
            index += 1
        }
        return nil
    }

    // MARK: Static helpers

    /// The ASCII punctuation set a backslash may escape (CommonMark).
    private static let escapable = Set("\\`*_{}[]()#+-.!~>|\"'/<>")

    static func isEscapable(_ char: Character) -> Bool {
        escapable.contains(char)
    }

    static func isEmail(_ value: String) -> Bool {
        guard let at = value.firstIndex(of: "@"), at != value.startIndex else { return false }
        let domain = value[value.index(after: at)...]
        return !domain.isEmpty && domain.contains(".") && !value.contains(where: \.isWhitespace)
    }

    /// Splits a link destination into the raw href + optional title, stripping `<…>` wrapping.
    static func parseDestination(_ raw: String) -> (destination: String, title: String?) {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard let space = trimmed.firstIndex(where: { $0 == " " }) else {
            return (stripAngles(trimmed), nil)
        }
        let destination = stripAngles(String(trimmed[..<space]))
        let rest = trimmed[trimmed.index(after: space)...].trimmingCharacters(in: .whitespaces)
        var title: String?
        if rest.count >= 2, let quote = rest.first, quote == "\"" || quote == "'", rest.hasSuffix(String(quote)) {
            title = String(rest.dropFirst().dropLast())
        }
        return (destination, title)
    }

    private static func stripAngles(_ value: String) -> String {
        guard value.hasPrefix("<"), value.hasSuffix(">"), value.count >= 2 else { return value }
        return String(value.dropFirst().dropLast())
    }
}
