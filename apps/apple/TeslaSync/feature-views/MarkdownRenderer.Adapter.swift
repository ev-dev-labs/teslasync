//
//  MarkdownRenderer.Adapter.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The block parser for the chatbot markdown renderer — the testable projection core that turns a raw
//  assistant message string into a `MarkdownDocument`, the faithful port of the react-markdown +
//  remark-gfm pipeline the web source drives. This file owns the document entry, the block dispatch, and
//  the single-line leaf blocks (headings, paragraphs, fenced code, thematic breaks) plus the shared line
//  classifier; the multi-line consumers (lists, blockquotes, tables) live in MarkdownRenderer.Blocks.swift.
//  Foundation-only so it is unit-tested without a bundle or a rendered view.
//

import Foundation

// MARK: - Parser entry

/// The dependency-free projection from a raw markdown string to a `MarkdownDocument`. Mirrors the web
/// source's renderer set: the same blocks, the same gfm features, and the same safe-by-default handling
/// (raw HTML is never interpreted — it survives as literal text through the inline parser).
public enum MarkdownParser {
    /// Parses a full assistant message into its block list. Blank input yields `MarkdownDocument.empty`,
    /// which drives the surface's empty state.
    public static func parse(_ source: String) -> MarkdownDocument {
        let lines = MarkdownLine.split(source)
        var reader = LineReader(lines)
        let blocks = parseBlocks(&reader)
        return MarkdownDocument(blocks: blocks)
    }

    /// Parses a block sequence from the reader until it is exhausted. Internal so the list / blockquote
    /// consumers can recursively parse nested content (sub-lists, quoted blocks).
    static func parseBlocks(_ reader: inout LineReader) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        while let line = reader.peek() {
            if MarkdownLine.isBlank(line) {
                reader.advance()
                continue
            }
            if let block = parseLeadingBlock(&reader, line: line) {
                blocks.append(block)
            } else {
                blocks.append(parseParagraph(&reader))
            }
        }
        return blocks
    }

    /// Tries each block constructor in precedence order; each either consumes its lines and returns a
    /// block, or returns `nil` without advancing so the caller falls through to a paragraph.
    private static func parseLeadingBlock(_ reader: inout LineReader, line: String) -> MarkdownBlock? {
        if let fence = parseFencedCode(&reader) { return fence }
        if MarkdownLine.isThematicBreak(line) {
            reader.advance()
            return .thematicBreak
        }
        if let heading = parseHeading(line) {
            reader.advance()
            return heading
        }
        if MarkdownLine.isBlockquote(line) { return parseBlockquote(&reader) }
        if let table = parseTable(&reader) { return table }
        if MarkdownLine.listMarker(line) != nil { return parseList(&reader) }
        return nil
    }

    // MARK: Headings

    /// An ATX heading: up to three leading spaces, 1–6 `#`, a space (or end of line), the inline content,
    /// and an optional trailing `#` run that is stripped (web `h1…h3`; deeper levels reuse h3 styling).
    static func parseHeading(_ line: String) -> MarkdownBlock? {
        let trimmed = MarkdownLine.dropLeadingSpaces(line, max: 3)
        let hashes = trimmed.prefix(while: { $0 == "#" })
        let level = hashes.count
        guard level >= 1, level <= 6 else { return nil }
        let afterHashes = trimmed.dropFirst(level)
        guard afterHashes.isEmpty || afterHashes.first == " " else { return nil }
        var content = afterHashes.trimmingCharacters(in: .whitespaces)
        while content.hasSuffix("#") {
            content.removeLast()
        }
        content = content.trimmingCharacters(in: .whitespaces)
        return .heading(level: level, inlines: MarkdownInlineParser.parse(content))
    }

    // MARK: Paragraphs

    /// A paragraph: consecutive non-blank lines that no other block construct interrupts, joined with
    /// newlines so the inline parser applies soft / hard breaks.
    static func parseParagraph(_ reader: inout LineReader) -> MarkdownBlock {
        var collected: [String] = []
        while let line = reader.peek() {
            if MarkdownLine.isBlank(line) { break }
            if !collected.isEmpty, MarkdownLine.interruptsParagraph(line) { break }
            collected.append(line)
            reader.advance()
        }
        let text = collected.joined(separator: "\n")
        return .paragraph(MarkdownInlineParser.parse(text))
    }

    // MARK: Fenced code

    /// A fenced code block opened by ``` ``` ``` / `~~~` (3+), capturing the info-string as the language and
    /// every following line verbatim until the matching close fence (or end of input). The body is never
    /// inline-parsed — parity with the web source delegating fenced code to CodeBlock as literal text.
    static func parseFencedCode(_ reader: inout LineReader) -> MarkdownBlock? {
        guard let first = reader.peek(), let fence = MarkdownLine.openingFence(first) else { return nil }
        reader.advance()
        var body: [String] = []
        while let line = reader.peek() {
            if MarkdownLine.isClosingFence(line, fence: fence) {
                reader.advance()
                break
            }
            body.append(line)
            reader.advance()
        }
        let language = fence.info.isEmpty ? nil : fence.info
        return .codeBlock(MarkdownCodeBlock(language: language, code: body.joined(separator: "\n")))
    }
}

// MARK: - Line reader

/// A forward cursor over the document's logical lines, with bounded look-ahead. Value type so nested
/// parsers operate on their own sub-reader without disturbing the parent cursor.
struct LineReader {
    private let lines: [String]
    private(set) var index = 0

    init(_ lines: [String]) {
        self.lines = lines
    }

    func peek(_ ahead: Int = 0) -> String? {
        let target = index + ahead
        guard target >= 0, target < lines.count else { return nil }
        return lines[target]
    }

    mutating func advance(_ count: Int = 1) {
        index += count
    }

    var isAtEnd: Bool {
        index >= lines.count
    }
}

// MARK: - Fence descriptor

/// A parsed opening code fence: its marker character, its run length, and the trimmed info-string.
struct MarkdownFence: Equatable {
    let marker: Character
    let length: Int
    let info: String
}

// MARK: - Line classifier

/// Shared, pure line-level predicates used across the block parsers. Kept in one place so the block
/// dispatch and the multi-line consumers agree on what a heading / fence / list / quote / break looks like.
enum MarkdownLine {
    /// Splits a source string into logical lines, normalizing CRLF/CR to LF and expanding tabs to spaces.
    static func split(_ source: String) -> [String] {
        let normalized = source
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\t", with: "    ")
        return normalized.components(separatedBy: "\n")
    }

    /// Whether a line is empty or only whitespace.
    static func isBlank(_ line: String) -> Bool {
        line.allSatisfy { $0 == " " }
    }

    /// The number of leading spaces.
    static func indent(_ line: String) -> Int {
        line.prefix(while: { $0 == " " }).count
    }

    /// Drops up to `max` leading spaces (CommonMark allows ≤3 before block markers).
    static func dropLeadingSpaces(_ line: String, max: Int) -> Substring {
        let drop = min(indent(line), max)
        return line.dropFirst(drop)
    }

    /// A blockquote line: ≤3 leading spaces then `>`.
    static func isBlockquote(_ line: String) -> Bool {
        dropLeadingSpaces(line, max: 3).first == ">"
    }

    /// A thematic break: ≤3 leading spaces then 3+ of `-`/`*`/`_` (spaces allowed between).
    static func isThematicBreak(_ line: String) -> Bool {
        let trimmed = dropLeadingSpaces(line, max: 3)
        guard let marker = trimmed.first, "-*_".contains(marker) else { return false }
        var count = 0
        for char in trimmed {
            if char == marker { count += 1 } else if char != " " { return false }
        }
        return count >= 3
    }

    /// Whether a non-first paragraph line is interrupted by a stronger block construct.
    static func interruptsParagraph(_ line: String) -> Bool {
        if isBlank(line) || isThematicBreak(line) || isBlockquote(line) { return true }
        if openingFence(line) != nil { return true }
        let trimmed = dropLeadingSpaces(line, max: 3)
        if trimmed.first == "#", MarkdownParser.parseHeading(line) != nil { return true }
        return listMarker(line) != nil
    }

    /// An opening fence (``` ``` ``` / `~~~`, 3+) → its descriptor; `nil` otherwise. Backtick fences may
    /// not carry a backtick in the info-string (CommonMark).
    static func openingFence(_ line: String) -> MarkdownFence? {
        let trimmed = dropLeadingSpaces(line, max: 3)
        guard let marker = trimmed.first, marker == "`" || marker == "~" else { return nil }
        let run = trimmed.prefix(while: { $0 == marker }).count
        guard run >= 3 else { return nil }
        let info = trimmed.dropFirst(run).trimmingCharacters(in: .whitespaces)
        if marker == "`", info.contains("`") { return nil }
        return MarkdownFence(marker: marker, length: run, info: info)
    }

    /// Whether a line closes the given fence: ≤3 spaces, a same-marker run ≥ the opener, only spaces after.
    static func isClosingFence(_ line: String, fence: MarkdownFence) -> Bool {
        let trimmed = dropLeadingSpaces(line, max: 3)
        guard trimmed.first == fence.marker else { return false }
        let run = trimmed.prefix(while: { $0 == fence.marker }).count
        guard run >= fence.length else { return false }
        return trimmed.dropFirst(run).allSatisfy { $0 == " " }
    }

    /// Parses a list marker (unordered `-`/`*`/`+` or ordered `N.`/`N)`), returning its descriptor.
    static func listMarker(_ line: String) -> MarkdownListMarker? {
        let spaces = indent(line)
        let body = line.dropFirst(spaces)
        if let marker = body.first, "-*+".contains(marker) {
            let after = body.dropFirst()
            guard after.isEmpty || after.first == " " else { return nil }
            let rest = after.hasPrefix(" ") ? String(after.dropFirst()) : ""
            return MarkdownListMarker(ordered: false, start: 1, contentIndent: spaces + 2, rest: rest)
        }
        let digits = body.prefix(while: { $0.isNumber })
        guard !digits.isEmpty, digits.count <= 9 else { return nil }
        let afterDigits = body.dropFirst(digits.count)
        guard let delim = afterDigits.first, delim == "." || delim == ")" else { return nil }
        let after = afterDigits.dropFirst()
        guard after.isEmpty || after.first == " " else { return nil }
        let rest = after.hasPrefix(" ") ? String(after.dropFirst()) : ""
        let width = spaces + digits.count + 2
        return MarkdownListMarker(ordered: true, start: Int(digits) ?? 1, contentIndent: width, rest: rest)
    }
}

/// A parsed list-item marker: list kind, the ordered start ordinal, the child indentation, and the item's
/// leading text (everything after the marker on its first line).
struct MarkdownListMarker: Equatable {
    let ordered: Bool
    let start: Int
    let contentIndent: Int
    let rest: String
}
