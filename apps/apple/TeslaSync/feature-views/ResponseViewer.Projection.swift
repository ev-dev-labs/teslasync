//
//  ResponseViewer.Projection.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  The pure projections that turn the surface inputs into the structural
//  decisions the view renders, plus the `ResponseViewerState` that drives the
//  loading / empty / loaded branch (web order: `loading` → skeleton, then
//  `!response` → empty, then `response` → the loaded panel). All of this is
//  host-free and `Equatable` so each branch is unit-testable.
//

import Foundation

// MARK: - Response projection (the loaded body)

/// The render-ready projection of an ``ApiResponse`` — the status line, its
/// semantic class, the `{duration}ms · {size}` meta line, the display body
/// (pretty-printed JSON when the content type is JSON, else the raw text, per
/// the web `contentType.includes('json') ? JSON.stringify(...) : bodyText`),
/// and the sorted header rows.
public struct ResponseProjection: Equatable, Sendable {
    public let statusCode: Int
    public let statusText: String
    /// The `"{code} {statusText}"` line (web status-bar left label). The status
    /// text is trimmed so an absent reason phrase doesn't leave a trailing space.
    public let statusLine: String
    public let statusClass: ResponseStatusClass
    /// The `"{duration}ms · {size}"` right label (web status-bar meta).
    public let metaLine: String
    /// The body text to render verbatim in the `<pre>` equivalent.
    public let displayBody: String
    /// The response headers as sorted, identifiable rows.
    public let headers: [ResponseHeaderItem]

    /// Header count (web `entries.length`, shown in the toggle label).
    public var headerCount: Int {
        headers.count
    }

    /// Whether the headers section renders at all (web returns `null` when empty).
    public var hasHeaders: Bool {
        !headers.isEmpty
    }

    public init(
        statusCode: Int,
        statusText: String,
        statusLine: String,
        statusClass: ResponseStatusClass,
        metaLine: String,
        displayBody: String,
        headers: [ResponseHeaderItem]
    ) {
        self.statusCode = statusCode
        self.statusText = statusText
        self.statusLine = statusLine
        self.statusClass = statusClass
        self.metaLine = metaLine
        self.displayBody = displayBody
        self.headers = headers
    }

    /// Builds the projection from a captured response.
    public static func make(from response: ApiResponse) -> ResponseProjection {
        ResponseProjection(
            statusCode: response.status,
            statusText: response.statusText,
            statusLine: statusLine(code: response.status, text: response.statusText),
            statusClass: ResponseStatusClass(status: response.status),
            metaLine: metaLine(durationMs: response.durationMs, size: response.size),
            displayBody: displayBody(contentType: response.contentType, bodyText: response.bodyText),
            headers: headerItems(from: response.headers)
        )
    }

    // MARK: Pure helpers (each mirrors one web expression)

    /// `"{code} {statusText}"`, trimming the reason phrase (web interpolation).
    static func statusLine(code: Int, text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "\(code)" : "\(code) \(trimmed)"
    }

    /// `"{duration}ms · {formatBytes(size)}"` (web status-bar meta).
    static func metaLine(durationMs: Int, size: Int) -> String {
        "\(durationMs)ms · \(ResponseByteFormat.string(size))"
    }

    /// Web `contentType.includes('json') && typeof body !== 'string'` →
    /// pretty-printed JSON, otherwise the raw `bodyText`. Native parses the body
    /// text when the content type is JSON and pretty-prints it; non-JSON or
    /// unparseable text falls through to the raw text.
    static func displayBody(contentType: String, bodyText: String) -> String {
        if contentType.lowercased().contains("json"), let pretty = prettyJSON(bodyText) {
            return pretty
        }
        return bodyText
    }

    /// Pretty-prints a JSON object/array string with two-space indentation, or
    /// returns `nil` when the text is not a JSON object/array (web only
    /// stringifies a structured body, never a bare string).
    static func prettyJSON(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data) else { return nil }
        guard JSONSerialization.isValidJSONObject(object) else { return nil }
        guard let pretty = try? JSONSerialization.data(
            withJSONObject: object,
            options: [.prettyPrinted]
        ) else { return nil }
        return String(bytes: pretty, encoding: .utf8)
    }

    /// Maps the header dictionary to rows sorted case-insensitively by name. The
    /// web iterates `Object.entries` in insertion order; native dictionaries are
    /// unordered, so a stable name sort keeps the render (and tests) determinate.
    static func headerItems(from headers: [String: String]) -> [ResponseHeaderItem] {
        headers
            .map { ResponseHeaderItem(name: $0.key, value: $0.value) }
            .sorted { $0.name.lowercased() < $1.name.lowercased() }
    }
}

// MARK: - History projection (the recent-requests chip)

/// The render-ready projection of a ``HistoryEntry`` — the method bucket, the
/// status class, the `"{duration}ms"` label, and the combined VoiceOver label
/// that mirrors the web chip `title` (`"{method} {path} → {status} ({ms}ms)"`).
public struct HistoryEntryProjection: Equatable, Sendable {
    public let method: String
    public let methodTone: HTTPMethodTone
    public let path: String
    public let statusCode: Int
    public let statusClass: ResponseStatusClass
    public let durationLabel: String
    public let accessibilityLabel: String

    public init(
        method: String,
        methodTone: HTTPMethodTone,
        path: String,
        statusCode: Int,
        statusClass: ResponseStatusClass,
        durationLabel: String,
        accessibilityLabel: String
    ) {
        self.method = method
        self.methodTone = methodTone
        self.path = path
        self.statusCode = statusCode
        self.statusClass = statusClass
        self.durationLabel = durationLabel
        self.accessibilityLabel = accessibilityLabel
    }

    public static func make(from entry: HistoryEntry) -> HistoryEntryProjection {
        HistoryEntryProjection(
            method: entry.method,
            methodTone: HTTPMethodTone(method: entry.method),
            path: entry.path,
            statusCode: entry.status,
            statusClass: ResponseStatusClass(status: entry.status),
            durationLabel: "\(entry.durationMs)ms",
            accessibilityLabel: accessibilityLabel(for: entry)
        )
    }

    /// `"{method} {path} → {status} ({duration}ms)"` (web chip `title`).
    static func accessibilityLabel(for entry: HistoryEntry) -> String {
        "\(entry.method) \(entry.path) → \(entry.status) (\(entry.durationMs)ms)"
    }
}

// MARK: - Surface state (web render order)

/// The top-level state the response panel renders, in the web source's exact
/// branch order: `loading` (skeleton), then no response (empty), then the
/// loaded projection.
public enum ResponseViewerState: Equatable, Sendable {
    case loading
    case empty
    case loaded(ResponseProjection)

    /// Derives the state from the two web inputs (`loading`, `response`).
    public init(response: ApiResponse?, loading: Bool) {
        if loading {
            self = .loading
        } else if let response {
            self = .loaded(ResponseProjection.make(from: response))
        } else {
            self = .empty
        }
    }
}
