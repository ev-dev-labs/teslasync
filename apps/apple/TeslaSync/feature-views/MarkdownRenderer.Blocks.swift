//
//  MarkdownRenderer.Blocks.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The multi-line block consumers for the chatbot markdown renderer's parser: bullet / numbered lists
//  (with gfm task items + nesting), blockquotes (nested blocks), and gfm tables (header + alignment +
//  body). Extends `MarkdownParser` from MarkdownRenderer.Adapter.swift; Foundation-only and unit-tested.
//

import Foundation

extension MarkdownParser {
    // MARK: - Lists

    /// Consumes a run of sibling list items into a `.unorderedList` / `.orderedList`. Each item collects
    /// its indented continuation lines (recursively parsed as child blocks, so nested lists round-trip)
    /// and its optional gfm task checkbox.
    static func parseList(_ reader: inout LineReader) -> MarkdownBlock {
        guard let first = reader.peek(), let firstMarker = MarkdownLine.listMarker(first) else {
            reader.advance()
            return .paragraph([])
        }
        let ordered = firstMarker.ordered
        var items: [MarkdownListItem] = []
        while let line = reader.peek(), let marker = MarkdownLine.listMarker(line), marker.ordered == ordered {
            reader.advance()
            let lines = collectItemLines(&reader, indent: marker.contentIndent, firstRest: marker.rest)
            items.append(makeItem(from: lines))
        }
        return ordered ? .orderedList(start: firstMarker.start, items: items) : .unorderedList(items)
    }

    /// Gathers an item's lines: its first-line remainder plus every following line indented to the item
    /// body (de-indented), tolerating internal blank lines when an indented continuation follows.
    private static func collectItemLines(
        _ reader: inout LineReader,
        indent: Int,
        firstRest: String
    ) -> [String] {
        var lines = [firstRest]
        while let next = reader.peek() {
            if MarkdownLine.isBlank(next) {
                guard continuationFollows(reader, indent: indent) else { break }
                lines.append("")
                reader.advance()
                continue
            }
            guard MarkdownLine.indent(next) >= indent else { break }
            lines.append(String(next.dropFirst(indent)))
            reader.advance()
        }
        while lines.last == "" {
            lines.removeLast()
        }
        return lines
    }

    /// Whether the line after the upcoming blank still belongs to the current item (indented to the body).
    private static func continuationFollows(_ reader: LineReader, indent: Int) -> Bool {
        guard let after = reader.peek(1), !MarkdownLine.isBlank(after) else { return false }
        return MarkdownLine.indent(after) >= indent
    }

    /// Builds an item from its collected lines: the first line is the leading inline content (after a gfm
    /// task checkbox), the remainder is recursively parsed as nested child blocks.
    private static func makeItem(from lines: [String]) -> MarkdownListItem {
        guard let firstLine = lines.first else { return MarkdownListItem(inlines: []) }
        let parsed = parseTask(firstLine)
        let inlines = MarkdownInlineParser.parse(parsed.text)
        let childLines = Array(lines.dropFirst())
        var children: [MarkdownBlock] = []
        if !childLines.allSatisfy(MarkdownLine.isBlank) {
            var childReader = LineReader(childLines)
            children = parseBlocks(&childReader)
        }
        return MarkdownListItem(inlines: inlines, task: parsed.task, children: children)
    }

    /// Splits a gfm task checkbox (`[ ]` / `[x]` / `[X]`) off the front of an item's first line.
    static func parseTask(_ text: String) -> (task: MarkdownTask?, text: String) {
        let chars = Array(text)
        guard chars.count >= 3, chars[0] == "[", chars[2] == "]" else { return (nil, text) }
        let task: MarkdownTask?
        switch chars[1] {
        case " ":
            task = .unchecked
        case "x", "X":
            task = .checked
        default:
            return (nil, text)
        }
        var rest = String(chars.dropFirst(3))
        if rest.hasPrefix(" ") { rest.removeFirst() }
        return (task, rest)
    }

    // MARK: - Blockquotes

    /// Consumes a run of `>`-prefixed lines, strips one quote marker from each, and recursively parses the
    /// inner content so quoted lists / code / paragraphs survive.
    static func parseBlockquote(_ reader: inout LineReader) -> MarkdownBlock {
        var inner: [String] = []
        while let line = reader.peek(), MarkdownLine.isBlockquote(line) {
            reader.advance()
            inner.append(stripQuoteMarker(line))
        }
        var childReader = LineReader(inner)
        return .blockquote(parseBlocks(&childReader))
    }

    private static func stripQuoteMarker(_ line: String) -> String {
        var rest = MarkdownLine.dropLeadingSpaces(line, max: 3)
        if rest.first == ">" { rest = rest.dropFirst() }
        if rest.first == " " { rest = rest.dropFirst() }
        return String(rest)
    }

    // MARK: - Tables (gfm)

    /// Parses a gfm table when the upcoming two lines are a header row + a delimiter row; returns `nil`
    /// without consuming otherwise so the caller can fall through to a paragraph.
    static func parseTable(_ reader: inout LineReader) -> MarkdownBlock? {
        guard let header = reader.peek(), header.contains("|"),
              let delimiter = reader.peek(1), isDelimiterRow(delimiter) else { return nil }
        let headerCells = splitRow(header)
        let columns = headerCells.count
        let headers = headerCells.map(MarkdownInlineParser.parse)
        let alignments = parseAlignments(delimiter, columns: columns)
        reader.advance(2)
        var rows: [[[MarkdownInline]]] = []
        while let line = reader.peek(), !MarkdownLine.isBlank(line), line.contains("|") {
            let cells = splitRow(line).map(MarkdownInlineParser.parse)
            rows.append(normalizeRow(cells, columns: columns))
            reader.advance()
        }
        return .table(MarkdownTable(headers: headers, alignments: alignments, rows: rows))
    }

    /// Whether a line is a table delimiter row (every cell is `:?-+:?`).
    static func isDelimiterRow(_ line: String) -> Bool {
        let cells = splitRow(line)
        guard !cells.isEmpty, line.contains("-") else { return false }
        return cells.allSatisfy(isDelimiterCell)
    }

    private static func isDelimiterCell(_ cell: String) -> Bool {
        var trimmed = Substring(cell)
        if trimmed.hasPrefix(":") { trimmed = trimmed.dropFirst() }
        if trimmed.hasSuffix(":") { trimmed = trimmed.dropLast() }
        return !trimmed.isEmpty && trimmed.allSatisfy { $0 == "-" }
    }

    private static func parseAlignments(_ delimiter: String, columns: Int) -> [MarkdownColumnAlignment] {
        var alignments = splitRow(delimiter).map(alignment(of:))
        if alignments.count < columns {
            alignments += Array(repeating: .none, count: columns - alignments.count)
        }
        return Array(alignments.prefix(columns))
    }

    private static func alignment(of cell: String) -> MarkdownColumnAlignment {
        let trimmed = cell.trimmingCharacters(in: .whitespaces)
        let left = trimmed.hasPrefix(":")
        let right = trimmed.hasSuffix(":")
        if left, right { return .center }
        if right { return .trailing }
        if left { return .leading }
        return .none
    }

    private static func normalizeRow(_ cells: [[MarkdownInline]], columns: Int) -> [[MarkdownInline]] {
        if cells.count == columns { return cells }
        if cells.count > columns { return Array(cells.prefix(columns)) }
        return cells + Array(repeating: [MarkdownInline](), count: columns - cells.count)
    }

    /// Splits a table row into trimmed raw cell strings, honoring outer pipes + `\|` escapes.
    static func splitRow(_ line: String) -> [String] {
        var body = line.trimmingCharacters(in: .whitespaces)
        if body.hasPrefix("|") { body.removeFirst() }
        if body.hasSuffix("|"), !body.hasSuffix("\\|") { body.removeLast() }
        let chars = Array(body)
        var cells: [String] = []
        var current = ""
        var index = 0
        while index < chars.count {
            let char = chars[index]
            if char == "\\", index + 1 < chars.count, chars[index + 1] == "|" {
                current.append("|")
                index += 2
                continue
            }
            if char == "|" {
                cells.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
                index += 1
                continue
            }
            current.append(char)
            index += 1
        }
        cells.append(current.trimmingCharacters(in: .whitespaces))
        return cells
    }
}
