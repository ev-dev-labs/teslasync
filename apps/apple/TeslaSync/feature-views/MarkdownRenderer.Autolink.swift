//
//  MarkdownRenderer.Autolink.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The gfm autolink-literal scanner (remark-gfm `autolink`) for the chatbot markdown renderer. Plain text
//  runs are scanned for bare `http(s)://…` / `www.…` URLs and split into tappable link spans, matching
//  the web source's remark-gfm pipeline. Foundation-only; trailing sentence punctuation + unbalanced
//  parentheses are trimmed off the URL so "see https://x.com." links `https://x.com` and keeps the `.`.
//

import Foundation

/// Splits a plain text run into `.text` + `.link` spans for any bare URLs it contains (gfm autolink
/// literals). Returns the single original text node when there is nothing to autolink — the hot path for
/// most prose.
public enum MarkdownAutolinker {
    private static let detector: NSRegularExpression? = try? NSRegularExpression(
        pattern: "(?:https?://|www\\.)[^\\s<>]+",
        options: [.caseInsensitive]
    )

    public static func scan(_ text: String) -> [MarkdownInline] {
        guard text.contains("http") || text.contains("www.") else { return [.text(text)] }
        guard let detector else { return [.text(text)] }
        let whole = NSRange(text.startIndex ..< text.endIndex, in: text)
        let matches = detector.matches(in: text, options: [], range: whole)
        guard !matches.isEmpty else { return [.text(text)] }

        var nodes: [MarkdownInline] = []
        var cursor = text.startIndex
        for match in matches {
            guard let range = Range(match.range, in: text), hasWordBoundary(text, before: range.lowerBound) else {
                continue
            }
            let urlText = trimTrailing(String(text[range]))
            guard !urlText.isEmpty else { continue }
            let endIndex = text.index(range.lowerBound, offsetBy: urlText.count)
            if cursor < range.lowerBound {
                nodes.append(.text(String(text[cursor ..< range.lowerBound])))
            }
            let destination = urlText.hasPrefix("www.") ? "http://" + urlText : urlText
            nodes.append(.link(MarkdownLink(children: [.text(urlText)], destination: destination)))
            cursor = endIndex
        }
        if cursor < text.endIndex {
            nodes.append(.text(String(text[cursor...])))
        }
        return nodes.isEmpty ? [.text(text)] : nodes
    }

    /// A URL literal only starts at a word boundary (start of run, after whitespace, or after an opening
    /// bracket/quote) so `foohttps://x` isn't linked.
    private static func hasWordBoundary(_ text: String, before index: String.Index) -> Bool {
        guard index > text.startIndex else { return true }
        let prev = text[text.index(before: index)]
        return prev.isWhitespace || "([{\"'".contains(prev)
    }

    /// Trims trailing sentence punctuation + unbalanced closing parens from a matched URL.
    private static func trimTrailing(_ url: String) -> String {
        var result = url
        while let last = result.last, ".,;:!?".contains(last) {
            result.removeLast()
        }
        guard result.hasSuffix(")") else { return result }
        let opens = result.reduce(into: 0) { total, char in if char == "(" { total += 1 } }
        var closes = result.reduce(into: 0) { total, char in if char == ")" { total += 1 } }
        while result.hasSuffix(")"), closes > opens {
            result.removeLast()
            closes -= 1
        }
        return result
    }
}
