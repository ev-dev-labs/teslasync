//
//  HttpStatusTool.Projection.swift
//  TeslaSync — P4 feature view · 0016 · HttpStatusTool (Apple)
//
//  The pure, Foundation-only adapter for the surface: the canonical HTTP
//  status-code catalog (a 1:1 port of the web `HTTP_CODES` constant), the
//  search filter (port of the web `filtered` useMemo), the code → tone map
//  (port of the web `Badge` variant ternary), the sort + pagination the web
//  `DataTable` enables (`sortable` code column + `pagination`, defaultPageSize
//  25), the P1/S10 i18n facade, and the testable VoiceOver summary. No SwiftUI
//  here so the projection can be compiled into a host harness and EXECUTED
//  (catalog → projection) without a simulator.
//
//  Web source (spec):
//  web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx
//

import Foundation

// MARK: - Catalog entry (web `HTTP_CODES` row: { code, text, desc })

/// One HTTP status-code reference row, mirroring the web `HTTP_CODES` entry
/// shape (`code` / `text` / `desc`). `id == code` so it is `Identifiable` for
/// SwiftUI `ForEach` without an extra key extractor (web `keyExtractor` =
/// `r.code`).
public struct HttpStatusCode: Sendable, Equatable, Identifiable {
    public var code: Int
    public var text: String
    public var desc: String

    public var id: Int {
        code
    }

    public init(code: Int, text: String, desc: String) {
        self.code = code
        self.text = text
        self.desc = desc
    }
}

// MARK: - Canonical catalog (verbatim port of the web `HTTP_CODES`)

/// The fixed reference dataset the tool renders, a verbatim port of the web
/// `HTTP_CODES` constant (same 19 rows, same order). It lives here — not in the
/// view — so the surface binds it through the state-holder seam exactly as the
/// web module imports the constant, and so the projection stays host-executable.
public enum HttpStatusCatalog {
    public static let codes: [HttpStatusCode] = [
        HttpStatusCode(code: 200, text: "OK", desc: "Request succeeded"),
        HttpStatusCode(code: 201, text: "Created", desc: "Resource created"),
        HttpStatusCode(code: 204, text: "No Content", desc: "Success with no body"),
        HttpStatusCode(code: 301, text: "Moved Permanently", desc: "Resource moved"),
        HttpStatusCode(code: 302, text: "Found", desc: "Temporary redirect"),
        HttpStatusCode(code: 304, text: "Not Modified", desc: "Use cached version"),
        HttpStatusCode(code: 400, text: "Bad Request", desc: "Invalid request"),
        HttpStatusCode(code: 401, text: "Unauthorized", desc: "Auth required"),
        HttpStatusCode(code: 403, text: "Forbidden", desc: "Access denied"),
        HttpStatusCode(code: 404, text: "Not Found", desc: "Resource not found"),
        HttpStatusCode(code: 405, text: "Method Not Allowed", desc: "HTTP method not supported"),
        HttpStatusCode(code: 408, text: "Request Timeout", desc: "Client took too long"),
        HttpStatusCode(code: 409, text: "Conflict", desc: "Resource conflict"),
        HttpStatusCode(code: 422, text: "Unprocessable Entity", desc: "Validation failed"),
        HttpStatusCode(code: 429, text: "Too Many Requests", desc: "Rate limited"),
        HttpStatusCode(code: 500, text: "Internal Server Error", desc: "Server error"),
        HttpStatusCode(code: 502, text: "Bad Gateway", desc: "Upstream error"),
        HttpStatusCode(code: 503, text: "Service Unavailable", desc: "Server overloaded"),
        HttpStatusCode(code: 504, text: "Gateway Timeout", desc: "Upstream timeout")
    ]
}

// MARK: - Tone (port of the web `Badge` variant ternary)

/// The semantic tone a status code maps to — the native counterpart of the web
/// `Badge` variant (`success` / `info` / `warning` / `danger`). It also names
/// the HTTP class so VoiceOver can convey the badge color as words (the web
/// relies on color alone; the native badge adds a textual class for a11y).
public enum HttpStatusTone: Sendable, Equatable {
    case success
    case info
    case warning
    case danger
}

// MARK: - Sort state (the web sortable `code` column)

/// The sort applied to the `code` column (web `DataTable` `sortable`). The web
/// `useSort` starts unsorted (natural catalog order) and toggles asc/desc on the
/// header; this reproduces that tri-state cycle.
public enum HttpStatusSort: Sendable, Equatable {
    case unsorted
    case ascending
    case descending

    /// The next state when the sortable header is activated (web `onSort`:
    /// unsorted → asc → desc → asc …). After the first activation it toggles
    /// between ascending and descending.
    public var next: HttpStatusSort {
        switch self {
        case .unsorted, .descending: .ascending
        case .ascending: .descending
        }
    }
}

// MARK: - Resolved row + projection (the native render model)

/// A fully-resolved table row: the catalog values plus the formatted code text
/// and the resolved tone. The view renders these directly (no derivation in the
/// view), mirroring the web `columns[].render` outputs.
public struct HttpStatusRow: Sendable, Equatable, Identifiable {
    public var code: Int
    public var codeText: String
    public var text: String
    public var desc: String
    public var tone: HttpStatusTone

    public var id: Int {
        code
    }

    public init(code: Int, codeText: String, text: String, desc: String, tone: HttpStatusTone) {
        self.code = code
        self.codeText = codeText
        self.text = text
        self.desc = desc
        self.tone = tone
    }
}

/// The fully-resolved render model — everything the web component derives from
/// `search` + `HTTP_CODES` + the `DataTable` sort/pagination before the JSX.
public struct HttpStatusProjection: Sendable, Equatable {
    public var rows: [HttpStatusRow]
    public var totalCount: Int
    public var filteredCount: Int
    public var page: Int
    public var pageCount: Int
    public var pageSize: Int
    public var rangeStart: Int
    public var rangeEnd: Int
    public var hasQuery: Bool

    /// The search matched nothing (web `DataTable` empty body). Distinct from a
    /// catalog with zero rows (which the model surfaces as the empty *phase*).
    public var isFilteredEmpty: Bool {
        filteredCount == 0
    }

    /// More than one page exists, so the pagination bar is meaningful (web only
    /// shows `Pagination` controls when `pagination` is on and rows overflow).
    public var hasPagination: Bool {
        pageCount > 1
    }

    public init(
        rows: [HttpStatusRow] = [],
        totalCount: Int = 0,
        filteredCount: Int = 0,
        page: Int = 1,
        pageCount: Int = 1,
        pageSize: Int = HttpStatusProjector.defaultPageSize,
        rangeStart: Int = 0,
        rangeEnd: Int = 0,
        hasQuery: Bool = false
    ) {
        self.rows = rows
        self.totalCount = totalCount
        self.filteredCount = filteredCount
        self.page = page
        self.pageCount = pageCount
        self.pageSize = pageSize
        self.rangeStart = rangeStart
        self.rangeEnd = rangeEnd
        self.hasQuery = hasQuery
    }
}

// MARK: - Projector (pure: catalog + UI state → projection)

/// Pure adapter reproducing the web derivations exactly: the `filtered` useMemo,
/// the `Badge` variant ternary, and the `DataTable` sort (`code`) + pagination
/// (`defaultPageSize ?? 25`). No SwiftUI, so it compiles into a host harness and
/// is EXECUTED in tests.
public enum HttpStatusProjector {
    /// The web `DataTable` `paginationConfig.defaultPageSize ?? 25`.
    public static let defaultPageSize = 25

    /// Port of the web `Badge` variant ternary:
    /// `code < 300 ? success : code < 400 ? info : code < 500 ? warning : danger`.
    public static func tone(forCode code: Int) -> HttpStatusTone {
        if code < 300 { return .success }
        if code < 400 { return .info }
        if code < 500 { return .warning }
        return .danger
    }

    /// Port of the web `filtered` useMemo. `if (!search.trim()) return HTTP_CODES`
    /// then `const q = search.toLowerCase()` (the raw, *un-trimmed* search) and
    /// `String(code).includes(q) || text.toLowerCase().includes(q) ||
    /// desc.toLowerCase().includes(q)`.
    public static func filter(_ codes: [HttpStatusCode], query: String) -> [HttpStatusCode] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return codes }
        let needle = query.lowercased()
        return codes.filter { entry in
            String(entry.code).contains(needle)
                || entry.text.lowercased().contains(needle)
                || entry.desc.lowercased().contains(needle)
        }
    }

    /// Applies the `code`-column sort (web `useSort` numeric compare). `unsorted`
    /// preserves catalog order.
    public static func sort(_ codes: [HttpStatusCode], by sort: HttpStatusSort) -> [HttpStatusCode] {
        switch sort {
        case .unsorted: codes
        case .ascending: codes.sorted { $0.code < $1.code }
        case .descending: codes.sorted { $0.code > $1.code }
        }
    }

    /// The number of pages for `count` rows at `pageSize` (web `Pagination`
    /// `Math.ceil(total / pageSize)`), never below 1.
    public static func pageCount(for count: Int, pageSize: Int) -> Int {
        guard pageSize > 0, count > 0 else { return 1 }
        return (count + pageSize - 1) / pageSize
    }

    /// The slice of `codes` for a 1-based `page` (web `data.slice((page-1)*size,
    /// page*size)`).
    public static func slice(_ codes: [HttpStatusCode], page: Int, pageSize: Int) -> [HttpStatusCode] {
        guard pageSize > 0 else { return codes }
        let start = max(0, (page - 1) * pageSize)
        guard start < codes.count else { return [] }
        let end = min(codes.count, start + pageSize)
        return Array(codes[start ..< end])
    }

    /// The formatted code text shown in the badge (web renders the raw number,
    /// no grouping — a status code is never grouped).
    public static func codeText(_ code: Int) -> String {
        String(code)
    }

    /// Resolves the full projection: filter → sort → clamp page → slice → map to
    /// rows, with the 1-based display range the pagination bar shows.
    public static func project(
        codes: [HttpStatusCode],
        query: String = "",
        sort: HttpStatusSort = .unsorted,
        page: Int = 1,
        pageSize: Int = defaultPageSize
    ) -> HttpStatusProjection {
        let filtered = sort.applied(to: filter(codes, query: query))
        let pages = pageCount(for: filtered.count, pageSize: pageSize)
        let clampedPage = min(max(1, page), pages)
        let pageRows = slice(filtered, page: clampedPage, pageSize: pageSize)
        let rows = pageRows.map { entry in
            HttpStatusRow(
                code: entry.code,
                codeText: codeText(entry.code),
                text: entry.text,
                desc: entry.desc,
                tone: tone(forCode: entry.code)
            )
        }
        let start = filtered.isEmpty ? 0 : (clampedPage - 1) * pageSize + 1
        let end = filtered.isEmpty ? 0 : min(filtered.count, clampedPage * pageSize)
        return HttpStatusProjection(
            rows: rows,
            totalCount: codes.count,
            filteredCount: filtered.count,
            page: clampedPage,
            pageCount: pages,
            pageSize: pageSize,
            rangeStart: start,
            rangeEnd: end,
            hasQuery: !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        )
    }
}

private extension HttpStatusSort {
    func applied(to codes: [HttpStatusCode]) -> [HttpStatusCode] {
        HttpStatusProjector.sort(codes, by: self)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no
/// code path holds a hardcoded literal. The web source uses natural-language
/// keys that are absent from `en.json`, so i18next renders them verbatim
/// (`t('Http Status')` → "Http Status"); the native fallbacks reproduce that
/// exactly. Keys live in the per-surface "HttpStatusTool" table, folded into the
/// app `Localizable.xcstrings` master catalog at integration time (kept separate
/// so each parallel surface owns its own strings without editing the shared
/// catalog). The SwiftUI `text(_:_:)` convenience is added in
/// `HttpStatusTool.Model.swift`.
public enum HttpStatusStrings {
    public static let table = "HttpStatusTool"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// A localized format string filled with one integer (web count interpolation).
    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// The localized HTTP-class word for a tone — the textual meaning of the
    /// badge color (added for VoiceOver; the web conveys class by color only).
    public static func toneLabel(_ tone: HttpStatusTone) -> String {
        switch tone {
        case .success: string("tool.httpStatus.toneSuccess", "Success")
        case .info: string("tool.httpStatus.toneInfo", "Redirect")
        case .warning: string("tool.httpStatus.toneWarning", "Client error")
        case .danger: string("tool.httpStatus.toneDanger", "Server error")
        }
    }

    /// The "start–end of total" range the pagination bar shows (web `Pagination`
    /// footer). Built with positional args so RTL/locale ordering is honored.
    public static func pageRange(start: Int, end: Int, total: Int) -> String {
        let format = string("tool.httpStatus.pageRange", "%1$lld–%2$lld of %3$lld")
        return String(format: format, start, end, total)
    }

    /// The "Page x of y" position the pagination bar shows.
    public static func pagePosition(page: Int, of pages: Int) -> String {
        let format = string("tool.httpStatus.pagePosition", "Page %1$lld of %2$lld")
        return String(format: format, page, pages)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the table region. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum HttpStatusAccessibility {
    /// Summarizes the filtered result count against the catalog total, mentioning
    /// the active query when the search is non-empty.
    public static func summary(for projection: HttpStatusProjection) -> String {
        let counts = HttpStatusStrings.count(
            "tool.httpStatus.summaryCount",
            "%lld status codes",
            projection.filteredCount
        )
        let ofTotal = HttpStatusStrings.count("tool.httpStatus.ofTotal", "of %lld", projection.totalCount)
        let base = counts + " " + ofTotal
        if projection.isFilteredEmpty {
            return HttpStatusStrings.string("tool.httpStatus.noMatches", "No matching status codes")
        }
        if projection.hasPagination {
            let position = HttpStatusStrings.pagePosition(page: projection.page, of: projection.pageCount)
            return base + ". " + position
        }
        return base
    }

    /// The per-row VoiceOver label: "{code} {class}. {text}. {desc}".
    public static func rowLabel(for row: HttpStatusRow) -> String {
        "\(row.codeText) \(HttpStatusStrings.toneLabel(row.tone)). \(row.text). \(row.desc)"
    }
}
